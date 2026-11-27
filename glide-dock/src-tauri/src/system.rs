//! Quick toggles and system actions. Where Windows has no public switch (night light, Focus, airplane mode,
//! energy saver), the toggle opens the right Settings page instead of pretending.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct ToggleState {
    pub wifi: Option<bool>,
    pub bluetooth: Option<bool>,
    pub dark: bool,
    pub keep_awake: bool,
    pub desktop_icons: bool,
    pub muted: bool,
    pub mic_muted: bool,
    pub taskbar_hidden: bool,
}

/// ms-settings pages for things Windows doesn't let apps switch directly.
pub fn settings_uri(id: &str) -> Option<&'static str> {
    Some(match id {
        "nightlight" => "ms-settings:nightlight",
        "focus" => "ms-settings:quiethours",
        "airplane" => "ms-settings:network-airplanemode",
        "energy" => "ms-settings:batterysaver",
        "hotspot" => "ms-settings:network-mobilehotspot",
        "display" => "ms-settings:display",
        "sound" => "ms-settings:sound",
        "network" => "ms-settings:network",
        "bluetooth-settings" => "ms-settings:bluetooth",
        _ => return None,
    })
}

#[cfg(windows)]
pub use win::*;

#[cfg(windows)]
mod win {
    use super::*;
    use crate::util::wide;
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::core::{w, PCWSTR};
    use windows::Devices::Radios::{Radio, RadioKind, RadioState};
    use windows::Win32::Foundation::*;
    use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
    use windows::Win32::System::Registry::*;
    use windows::Win32::System::Shutdown::LockWorkStation;
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_LWIN};
    use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHQueryRecycleBinW, SHQUERYRBINFO};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static AWAKE: AtomicBool = AtomicBool::new(false);
    const THEME_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");

    // ---------- dark mode ----------
    pub fn dark() -> bool {
        let mut v = 1u32;
        let mut n = 4u32;
        unsafe {
            let _ = RegGetValueW(HKEY_CURRENT_USER, THEME_KEY, w!("AppsUseLightTheme"), RRF_RT_REG_DWORD, None, Some(&mut v as *mut _ as *mut _), Some(&mut n));
        }
        v == 0
    }

    pub fn set_dark(on: bool) {
        let v: u32 = if on { 0 } else { 1 };
        unsafe {
            for name in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
                let _ = RegSetKeyValueW(HKEY_CURRENT_USER, THEME_KEY, name, REG_DWORD.0, Some(&v as *const _ as *const _), 4);
            }
            let msg = wide("ImmersiveColorSet");
            let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(msg.as_ptr() as isize), SMTO_ABORTIFHUNG, 300, None);
        }
    }

    // ---------- keep awake (must run on one long-lived thread: Tauri's main thread) ----------
    pub fn keep_awake() -> bool {
        AWAKE.load(Ordering::Relaxed)
    }

    pub fn set_keep_awake(on: bool) {
        unsafe {
            if on {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
            } else {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
        AWAKE.store(on, Ordering::Relaxed);
    }

    // ---------- desktop icons ----------
    fn desktop_list() -> Option<HWND> {
        unsafe {
            let progman = FindWindowW(w!("Progman"), None).ok()?;
            let mut defview = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).ok();
            if defview.is_none() {
                // after a wallpaper slideshow the icons live under a WorkerW window
                let mut ww: Option<HWND> = None;
                loop {
                    let next = FindWindowExW(None, ww, w!("WorkerW"), None).ok()?;
                    if let Ok(d) = FindWindowExW(Some(next), None, w!("SHELLDLL_DefView"), None) {
                        defview = Some(d);
                        break;
                    }
                    ww = Some(next);
                }
            }
            FindWindowExW(defview, None, w!("SysListView32"), None).ok()
        }
    }

    pub fn desktop_icons() -> bool {
        desktop_list().map(|h| unsafe { IsWindowVisible(h).as_bool() }).unwrap_or(true)
    }

    pub fn set_desktop_icons(show: bool) {
        if let Some(h) = desktop_list() {
            unsafe {
                let _ = ShowWindow(h, if show { SW_SHOW } else { SW_HIDE });
            }
        }
    }

    // ---------- radios (Wi-Fi / Bluetooth) ----------
    fn radio(kind: RadioKind) -> Option<Radio> {
        crate::util::com();
        let _ = Radio::RequestAccessAsync().ok()?.join();
        let list = Radio::GetRadiosAsync().ok()?.join().ok()?;
        (0..list.Size().ok()?).filter_map(|i| list.GetAt(i).ok()).find(|r| r.Kind().ok() == Some(kind))
    }

    pub fn radio_on(kind: &str) -> Option<bool> {
        let k = if kind == "wifi" { RadioKind::WiFi } else { RadioKind::Bluetooth };
        radio(k).and_then(|r| r.State().ok()).map(|s| s == RadioState::On)
    }

    pub fn set_radio(kind: &str, on: bool) -> bool {
        let k = if kind == "wifi" { RadioKind::WiFi } else { RadioKind::Bluetooth };
        match radio(k) {
            Some(r) => r
                .SetStateAsync(if on { RadioState::On } else { RadioState::Off })
                .ok()
                .and_then(|op| op.join().ok())
                .map(|a| a == windows::Devices::Radios::RadioAccessStatus::Allowed)
                .unwrap_or(false),
            None => false,
        }
    }

    // ---------- actions ----------
    pub fn lock() {
        unsafe {
            let _ = LockWorkStation();
        }
    }

    pub fn show_desktop() {
        unsafe {
            keybd_event(VK_LWIN.0 as u8, 0, Default::default(), 0);
            keybd_event(b'D', 0, Default::default(), 0);
            keybd_event(b'D', 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_LWIN.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    pub fn power(action: &str) {
        use std::os::windows::process::CommandExt;
        let args: &[&str] = match action {
            "sleep" => {
                // rundll32 is the documented-enough path without linking powrprof for one call
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["powrprof.dll,SetSuspendState", "0,1,0"])
                    .creation_flags(0x0800_0000)
                    .spawn();
                return;
            }
            "restart" => &["/r", "/t", "0"],
            "shutdown" => &["/s", "/hybrid", "/t", "0"],
            "signout" => &["/l"],
            _ => return,
        };
        let _ = std::process::Command::new("shutdown.exe").args(args).creation_flags(0x0800_0000).spawn();
    }

    /// (items, bytes) in the Recycle Bin
    pub fn recycle_info() -> (i64, i64) {
        let mut q = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
        unsafe {
            let _ = SHQueryRecycleBinW(PCWSTR::null(), &mut q);
        }
        (q.i64NumItems, q.i64Size)
    }

    /// Windows shows its own "are you sure" box.
    pub fn empty_recycle() {
        unsafe {
            let _ = SHEmptyRecycleBinW(None, PCWSTR::null(), 0);
        }
    }

    pub fn state(taskbar_hidden: bool) -> ToggleState {
        let a = crate::audio::state();
        ToggleState {
            wifi: radio_on("wifi"),
            bluetooth: radio_on("bluetooth"),
            dark: dark(),
            keep_awake: keep_awake(),
            desktop_icons: desktop_icons(),
            muted: a.muted,
            mic_muted: a.mic_muted,
            taskbar_hidden,
        }
    }
}

#[cfg(not(windows))]
pub fn state(taskbar_hidden: bool) -> ToggleState {
    ToggleState { taskbar_hidden, ..Default::default() }
}
