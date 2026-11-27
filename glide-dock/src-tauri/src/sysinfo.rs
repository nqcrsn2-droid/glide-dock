//! CPU, memory, network speed, battery, disk and uptime. Sampled every 2 s, but only while a widget that shows
//! them is on the bar and no full-screen app is running. Otherwise the thread sleeps and costs nothing.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Serialize, Clone, Debug, Default)]
pub struct Stats {
    pub cpu: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub ram_pct: f32,
    pub net_down: f64,
    pub net_up: f64,
    pub battery: Option<u32>,
    pub charging: bool,
    pub disk_free_gb: f32,
    pub disk_total_gb: f32,
    pub uptime_s: u64,
}

/// the bar has a stats widget / the popup shows the system panel
pub static WANTED: AtomicBool = AtomicBool::new(false);
pub static WANTED_POPUP: AtomicBool = AtomicBool::new(false);
pub static PAUSED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
pub use win::start;

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle) {}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::util::wide;
    use tauri::{AppHandle, Emitter};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::GetSystemTimes;

    fn ft(f: FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    fn cpu_times() -> (u64, u64) {
        let (mut i, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        unsafe {
            let _ = GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u));
        }
        (ft(i), ft(k) + ft(u)) // kernel time includes idle
    }

    fn net_bytes() -> (u64, u64) {
        let (mut rx, mut tx) = (0u64, 0u64);
        unsafe {
            let mut t: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut t).is_ok() && !t.is_null() {
                let n = (*t).NumEntries as usize;
                let rows = std::slice::from_raw_parts((*t).Table.as_ptr(), n);
                for r in rows {
                    // 6 = ethernet, 71 = wi-fi; skip loopback, tunnels and virtual filter rows
                    let physical = r.Type == 6 || r.Type == 71;
                    if physical && r.OperStatus == IfOperStatusUp && r.InterfaceAndOperStatusFlags._bitfield & 1 != 0 {
                        rx += r.InOctets;
                        tx += r.OutOctets;
                    }
                }
                FreeMibTable(t as *const _);
            }
        }
        (rx, tx)
    }

    fn sample(prev: &mut (u64, u64, u64, u64, std::time::Instant)) -> Stats {
        let mut s = Stats::default();
        let (idle, total) = cpu_times();
        let (rx, tx) = net_bytes();
        let now = std::time::Instant::now();
        let dt = now.duration_since(prev.4).as_secs_f64().max(0.1);
        let (di, dtot) = (idle.saturating_sub(prev.0), total.saturating_sub(prev.1));
        s.cpu = if dtot > 0 { (100.0 * (1.0 - di as f64 / dtot as f64)).clamp(0.0, 100.0) as f32 } else { 0.0 };
        if prev.2 > 0 {
            s.net_down = rx.saturating_sub(prev.2) as f64 / dt;
            s.net_up = tx.saturating_sub(prev.3) as f64 / dt;
        }
        *prev = (idle, total, rx, tx, now);
        unsafe {
            let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
            if GlobalMemoryStatusEx(&mut m).is_ok() {
                let gb = 1024.0 * 1024.0 * 1024.0;
                s.ram_total_gb = (m.ullTotalPhys as f64 / gb) as f32;
                s.ram_used_gb = ((m.ullTotalPhys - m.ullAvailPhys) as f64 / gb) as f32;
                s.ram_pct = m.dwMemoryLoad as f32;
            }
            let mut p = SYSTEM_POWER_STATUS::default();
            if GetSystemPowerStatus(&mut p).is_ok() && p.BatteryFlag != 128 && p.BatteryFlag != 255 && p.BatteryLifePercent <= 100 {
                s.battery = Some(p.BatteryLifePercent as u32);
                s.charging = p.ACLineStatus == 1;
            }
            let drive = wide(&std::env::var("SystemDrive").map(|d| d + "\\").unwrap_or_else(|_| "C:\\".into()));
            let (mut free, mut total) = (0u64, 0u64);
            if GetDiskFreeSpaceExW(PCWSTR(drive.as_ptr()), Some(&mut free), Some(&mut total), None).is_ok() {
                s.disk_free_gb = (free as f64 / 1e9) as f32;
                s.disk_total_gb = (total as f64 / 1e9) as f32;
            }
            s.uptime_s = GetTickCount64() / 1000;
        }
        s
    }

    pub fn start(app: AppHandle) {
        std::thread::Builder::new()
            .name("stats".into())
            .spawn(move || {
                let (i, t) = cpu_times();
                let (rx, tx) = net_bytes();
                let mut prev = (i, t, rx, tx, std::time::Instant::now());
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    if !(WANTED.load(Ordering::Relaxed) || WANTED_POPUP.load(Ordering::Relaxed)) || PAUSED.load(Ordering::Relaxed) {
                        // keep the baseline fresh so the first sample after waking is right
                        let (i, t) = cpu_times();
                        prev = (i, t, 0, 0, std::time::Instant::now());
                        continue;
                    }
                    let s = sample(&mut prev);
                    let _ = app.emit("stats", &s);
                }
            })
            .ok();
    }
}
