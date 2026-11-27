//! The Windows taskbar's auto-hide setting, changed safely.
//!
//! Glide Dock never hides or kills the real taskbar. It only flips Windows' own "Automatically hide the taskbar"
//! setting (the same switch as in Settings > Personalization > Taskbar), and puts it back:
//!   * when the dock quits normally, and
//!   * on the next start, if the dock crashed or the PC lost power while it was running.
//! The original state is written to a small marker file BEFORE anything is changed, so it can always be restored.

use std::{fs, path::PathBuf};

const MARKER: &str = "taskbar_restore.json";

#[cfg(windows)]
mod win {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, APPBARDATA};
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;

    pub const ABS_AUTOHIDE: u32 = 0x1;

    fn data() -> APPBARDATA {
        let mut abd = APPBARDATA::default();
        abd.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        abd.hWnd = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.unwrap_or(HWND::default());
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
}

fn marker(dir: &PathBuf) -> PathBuf {
    dir.join(MARKER)
}

/// Called first thing at start-up: if a previous run left the taskbar changed (crash, power loss), put it back.
pub fn recover(dir: &PathBuf) {
    if let Ok(t) = fs::read_to_string(marker(dir)) {
        if let Ok(state) = t.trim().parse::<u32>() {
            #[cfg(windows)]
            win::set(state);
            let _ = state;
        }
        let _ = fs::remove_file(marker(dir));
    }
}

/// Turn auto-hide on for the Windows taskbar, remembering how it was.
pub fn hide(dir: &PathBuf) {
    #[cfg(windows)]
    {
        if marker(dir).exists() {
            return; // already changed by us this run
        }
        let original = win::get();
        if original & win::ABS_AUTOHIDE != 0 {
            return; // the user already has auto-hide on: nothing to change or restore
        }
        let _ = fs::create_dir_all(dir);
        if fs::write(marker(dir), original.to_string()).is_err() {
            return; // can't record the original state, so don't touch anything
        }
        win::set(original | win::ABS_AUTOHIDE);
    }
    #[cfg(not(windows))]
    let _ = dir;
}

/// Put the Windows taskbar back the way it was before Glide Dock changed it.
pub fn restore(dir: &PathBuf) {
    recover(dir);
}
