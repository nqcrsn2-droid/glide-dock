//! Running apps, event-driven.
//!
//! Windows tells us (WinEvent hooks, no polling) when a window is created, destroyed, shown, hidden, renamed,
//! minimized, cloaked or brought to the front. A worker thread waits for those events, waits 80 ms for bursts to
//! settle, re-lists the taskbar-style windows and pushes the list to the bar only if it changed.

use serde::Serialize;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct AppWin {
    pub hwnd: i64,
    pub title: String,
    pub minimized: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct RunningApp {
    /// What launches it: an .exe path or "shell:AppsFolder\<AppID>" for Store apps.
    pub target: String,
    pub name: String,
    pub windows: Vec<AppWin>,
    pub active: bool,
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub fn list() -> Vec<RunningApp> {
    vec![]
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::util::{from_wide, wide};
    use std::collections::HashMap;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows::core::{BOOL, PCWSTR, PWSTR};
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
    use windows::Win32::System::Threading::*;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static TX: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
    static LAST_FG: Mutex<isize> = Mutex::new(0);
    static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    static LAST: Mutex<Vec<RunningApp>> = Mutex::new(Vec::new());
    static PAUSED: Mutex<bool> = Mutex::new(false);

    fn own_pid() -> u32 {
        std::process::id()
    }

    /// Install the hooks (must be called on a thread with a message loop: Tauri's main thread) and start the worker.
    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        let (tx, rx) = channel::<()>();
        let _ = TX.set(Mutex::new(tx));
        std::thread::Builder::new().name("apps".into()).spawn(move || worker(rx)).ok();
        unsafe {
            let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
            for (a, b) in [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
                (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
            ] {
                SetWinEventHook(a, b, None, Some(hook), 0, 0, flags);
            }
            let fg = GetForegroundWindow();
            *LAST_FG.lock().unwrap() = fg.0 as isize;
        }
        poke();
    }

    /// Stop pushing updates while a full-screen app runs; catch up when it ends.
    pub fn pause(p: bool) {
        *PAUSED.lock().unwrap() = p;
        if !p {
            poke();
        }
    }

    fn poke() {
        if let Some(tx) = TX.get() {
            let _ = tx.lock().unwrap().send(());
        }
    }

    unsafe extern "system" fn hook(_h: HWINEVENTHOOK, ev: u32, hwnd: HWND, id_obj: i32, id_child: i32, _t: u32, _ms: u32) {
        if hwnd.0.is_null() || id_obj != OBJID_WINDOW.0 || id_child != CHILDID_SELF as i32 {
            return;
        }
        if GetAncestor(hwnd, GA_ROOT) != hwnd {
            return;
        }
        if ev == EVENT_SYSTEM_FOREGROUND {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != own_pid() {
                *LAST_FG.lock().unwrap() = hwnd.0 as isize;
            }
        }
        poke();
    }

    fn worker(rx: Receiver<()>) {
        crate::util::com();
        while rx.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(80));
            while rx.try_recv().is_ok() {}
            if *PAUSED.lock().unwrap() {
                continue;
            }
            let now = list();
            let changed = {
                let mut last = LAST.lock().unwrap();
                if *last != now {
                    *last = now.clone();
                    true
                } else {
                    false
                }
            };
            if changed {
                if let Some(app) = APP.get() {
                    let _ = app.emit("apps", &now);
                }
            }
        }
    }

    /// The windows a taskbar would show, grouped by app, in z-order (front first).
    pub fn list() -> Vec<RunningApp> {
        let mut hwnds: Vec<HWND> = Vec::new();
        unsafe extern "system" fn cb(h: HWND, lp: LPARAM) -> BOOL {
            let v = &mut *(lp.0 as *mut Vec<HWND>);
            v.push(h);
            TRUE
        }
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut hwnds as *mut _ as isize));
        }
        let fg = *LAST_FG.lock().unwrap();
        let mut out: Vec<RunningApp> = Vec::new();
        for h in hwnds {
            if !is_taskbar_window(h) {
                continue;
            }
            let Some(target) = target_of(h) else { continue };
            let title = title_of(h);
            let minimized = unsafe { IsIconic(h).as_bool() };
            let w = AppWin { hwnd: h.0 as i64, title, minimized };
            let active = h.0 as isize == fg;
            let key = target.to_lowercase();
            if let Some(a) = out.iter_mut().find(|a| a.target.to_lowercase() == key) {
                a.windows.push(w);
                a.active |= active;
            } else {
                out.push(RunningApp { name: name_of(&target), target, windows: vec![w], active });
            }
        }
        out
    }

    fn is_taskbar_window(h: HWND) -> bool {
        unsafe {
            if !IsWindowVisible(h).as_bool() {
                return false;
            }
            if GetWindow(h, GW_OWNER).map(|o| !o.0.is_null()).unwrap_or(false) {
                return false;
            }
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            if ex & WS_EX_APPWINDOW.0 == 0 && (ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0) {
                return false;
            }
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4).is_ok() && cloaked != 0 {
                return false;
            }
            if GetWindowTextLengthW(h) == 0 {
                return false;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            pid != own_pid()
        }
    }

    fn title_of(h: HWND) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { GetWindowTextW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn pid_of(h: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid
    }

    /// Store apps run inside ApplicationFrameHost; the real app is a child window from another process.
    fn real_pid(h: HWND, pid: u32) -> u32 {
        struct Find {
            host: u32,
            found: u32,
        }
        unsafe extern "system" fn cb(c: HWND, lp: LPARAM) -> BOOL {
            let f = &mut *(lp.0 as *mut Find);
            let p = pid_of(c);
            if p != f.host {
                f.found = p;
                return FALSE;
            }
            TRUE
        }
        let mut f = Find { host: pid, found: 0 };
        unsafe {
            let _ = EnumChildWindows(Some(h), Some(cb), LPARAM(&mut f as *mut _ as isize));
        }
        if f.found != 0 {
            f.found
        } else {
            pid
        }
    }

    fn exe_of(pid: u32) -> Option<String> {
        unsafe {
            let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let r = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(p);
            r.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    fn aumid_of(pid: u32) -> Option<String> {
        unsafe {
            let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let r = GetApplicationUserModelId(p, &mut len, Some(PWSTR(buf.as_mut_ptr())));
            let _ = CloseHandle(p);
            if r != ERROR_SUCCESS {
                return None;
            }
            Some(from_wide(&buf))
        }
    }

    fn target_of(h: HWND) -> Option<String> {
        let mut pid = pid_of(h);
        let exe = exe_of(pid)?;
        if exe.to_lowercase().ends_with("\\applicationframehost.exe") {
            pid = real_pid(h, pid);
        }
        if let Some(id) = aumid_of(pid) {
            return Some(format!("shell:AppsFolder\\{}", id));
        }
        exe_of(pid)
    }

    /// Friendly name: the exe's "File description", the Store app's display name, or the file name.
    pub fn name_of(target: &str) -> String {
        let key = target.to_lowercase();
        if let Some(n) = NAMES.lock().unwrap().as_ref().and_then(|m| m.get(&key)) {
            return n.clone();
        }
        let n = if target.starts_with("shell:") { shell_display_name(target) } else { file_description(target) }
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                std::path::Path::new(target).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
            });
        NAMES.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, n.clone());
        n
    }

    fn shell_display_name(target: &str) -> Option<String> {
        crate::util::com();
        let w = wide(target);
        unsafe {
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None).ok()?;
            let p = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
            let s = p.to_string().ok();
            windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            s
        }
    }

    fn file_description(path: &str) -> Option<String> {
        let w = wide(path);
        unsafe {
            let size = GetFileVersionInfoSizeW(PCWSTR(w.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(PCWSTR(w.as_ptr()), None, size, data.as_mut_ptr() as *mut _).ok()?;
            let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut len = 0u32;
            let q = wide("\\VarFileInfo\\Translation");
            if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(q.as_ptr()), &mut ptr, &mut len).as_bool() || len < 4 {
                return None;
            }
            let lang = *(ptr as *const u16);
            let cp = *((ptr as *const u16).add(1));
            let q = wide(&format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", lang, cp));
            if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(q.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
            Some(from_wide(s))
        }
    }

    // ---------- actions ----------

    pub fn launch(target: &str) {
        let verb = wide("open");
        let file = wide(target);
        unsafe {
            ShellExecuteW(None, PCWSTR(verb.as_ptr()), PCWSTR(file.as_ptr()), None, None, SW_SHOWNORMAL);
        }
    }

    pub fn activate(h: HWND) {
        unsafe {
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            if !SetForegroundWindow(h).as_bool() || GetForegroundWindow() != h {
                // Windows only lets the foreground app hand over focus; a tap of Alt counts as fresh input.
                keybd_event(VK_MENU.0 as u8, 0, Default::default(), 0);
                keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
                let _ = SetForegroundWindow(h);
            }
        }
    }

    pub fn minimize(h: HWND) {
        unsafe {
            let _ = ShowWindow(h, SW_MINIMIZE);
        }
    }

    pub fn close(h: HWND) {
        unsafe {
            let _ = PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }

    /// Dock icon clicked: launch if not running; otherwise bring it up, minimise it if it's already in front,
    /// or cycle through its windows.
    pub fn click(target: &str) {
        let key = target.to_lowercase();
        let apps = list();
        let Some(app) = apps.iter().find(|a| a.target.to_lowercase() == key) else {
            launch(target);
            return;
        };
        let fg = *LAST_FG.lock().unwrap() as i64;
        let wins: Vec<HWND> = app.windows.iter().map(|w| HWND(w.hwnd as _)).collect();
        if let Some(i) = app.windows.iter().position(|w| w.hwnd == fg && !w.minimized) {
            if wins.len() == 1 {
                minimize(wins[0]);
            } else {
                // z-order: front first, so the last one is the one least recently used
                let next = wins[(i + wins.len() - 1) % wins.len()];
                activate(next);
            }
        } else {
            activate(wins[0]);
        }
    }
}
