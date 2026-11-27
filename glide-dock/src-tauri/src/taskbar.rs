//! The Windows taskbar, changed safely.
//!
//! While Glide Dock runs with "Hide the Windows taskbar" on, it:
//!   1. turns on Windows' own "Automatically hide the taskbar" setting, so the taskbar gives its screen space
//!      back, and
//!   2. hides the taskbar windows completely, so they don't slide up when you close an app or move the mouse
//!      to the bottom edge. If Windows shows them again (Start key, app closing), they are hidden again at once.
//!
//! Glide Dock never kills or patches Explorer. Everything is put back:
//!   * when the dock quits, from the tray menu, or from Settings,
//!   * on the next start, if the dock crashed or the PC lost power (the original setting is written to a small
//!     marker file BEFORE anything is changed),
//!   * by restarting Explorer or the PC: hidden windows don't survive that, only the auto-hide setting does,
//!     and the next start of the dock puts that back too.

use std::{fs, path::PathBuf};

const MARKER: &str = "taskbar_restore.json";

fn marker(dir: &PathBuf) -> PathBuf {
    dir.join(MARKER)
}

#[cfg(windows)]
mod win {
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_GETTASKBARPOS, ABM_SETSTATE, APPBARDATA};
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, GetClassNameW, ShowWindow, SW_HIDE, SW_SHOWNA};

    pub const ABS_AUTOHIDE: u32 = 0x1;
    pub static HIDDEN: AtomicBool = AtomicBool::new(false);

    fn tray() -> HWND {
        unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.unwrap_or_default()
    }

    /// The main taskbar plus the ones on other monitors.
    pub fn tray_windows() -> Vec<HWND> {
        let mut v = vec![];
        let t = tray();
        if !t.0.is_null() {
            v.push(t);
        }
        let mut prev: Option<HWND> = None;
        for _ in 0..16 {
            match unsafe { FindWindowExW(None, prev, w!("Shell_SecondaryTrayWnd"), None) } {
                Ok(h) if !h.0.is_null() => {
                    v.push(h);
                    prev = Some(h);
                }
                _ => break,
            }
        }
        v
    }

    /// The taskbar's current data, including the edge it is on, so changing the state never moves it.
    fn data() -> APPBARDATA {
        let mut abd = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: tray(), ..Default::default() };
        unsafe {
            SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd);
        }
        abd.hWnd = tray();
        abd
    }

    pub fn get() -> u32 {
        let mut abd = data();
        unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) as u32 }
    }

    pub fn set(state: u32) {
        let mut abd = data();
        abd.lParam = LPARAM(state as isize);
        unsafe {
            SHAppBarMessage(ABM_SETSTATE, &mut abd);
        }
    }

    pub fn set_visible(show: bool) {
        HIDDEN.store(!show, Ordering::SeqCst);
        for h in tray_windows() {
            unsafe {
                let _ = ShowWindow(h, if show { SW_SHOWNA } else { SW_HIDE });
            }
        }
    }

    /// Called for every window Windows shows: if it's a taskbar and we're hiding taskbars, hide it again.
    pub fn enforce(h: HWND) {
        if !HIDDEN.load(Ordering::Relaxed) {
            return;
        }
        let mut buf = [0u16; 32];
        let n = unsafe { GetClassNameW(h, &mut buf) } as usize;
        let name = String::from_utf16_lossy(&buf[..n.min(buf.len())]);
        if name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd" {
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
    }
}

#[cfg(windows)]
pub use win::enforce;

/// Called first thing at start-up: if a previous run left the taskbar changed (crash, power loss), put it back.
pub fn recover(dir: &PathBuf) {
    let Ok(t) = fs::read_to_string(marker(dir)) else { return };
    #[cfg(windows)]
    {
        win::set_visible(true);
        if let Ok(state) = t.trim().parse::<u32>() {
            win::set(state);
        }
    }
    let _ = t;
    let _ = fs::remove_file(marker(dir));
}

/// Hide the Windows taskbar, remembering how it was.
pub fn hide(dir: &PathBuf) {
    #[cfg(windows)]
    {
        if !marker(dir).exists() {
            let original = win::get();
            let _ = fs::create_dir_all(dir);
            if fs::write(marker(dir), original.to_string()).is_err() {
                return; // can't record the original state, so don't touch anything
            }
            if original & win::ABS_AUTOHIDE == 0 {
                win::set(original | win::ABS_AUTOHIDE);
            }
        }
        win::set_visible(false);
    }
    #[cfg(not(windows))]
    let _ = dir;
}

/// Put the Windows taskbar back the way it was before Glide Dock changed it.
pub fn restore(dir: &PathBuf) {
    #[cfg(windows)]
    win::set_visible(true);
    recover(dir);
}
