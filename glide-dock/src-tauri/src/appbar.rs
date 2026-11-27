//! Registers each dock window as a Windows "app bar" on the bottom edge of its monitor.
//!
//! This is the official mechanism Windows' own taskbar uses: maximized windows stop above the dock instead of
//! sliding under it, and Windows tells us (with messages, no polling) when:
//!   * a full-screen app or game comes to the front or leaves (ABN_FULLSCREENAPP) -> hide / show the dock
//!   * other bars move or the screen layout changes (ABN_POSCHANGED, WM_DISPLAYCHANGE, WM_DPICHANGED) -> re-place it
//! The reserved space is released on quit (ABM_REMOVE); Windows also frees it if the process dies.

#[cfg(windows)]
pub use win::*;

/// Logical-pixel geometry the dock wants; scaled by the monitor DPI at placement time.
#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    pub height: u32,
    pub margin: u32,
    pub hide_in_fullscreen: bool,
}

#[cfg(windows)]
mod win {
    use super::Geometry;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABM_ACTIVATE, ABM_NEW,
        ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED, APPBARDATA,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        RegisterWindowMessageW, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE,
        WM_ACTIVATE, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_WINDOWPOSCHANGED,
    };

    struct State {
        geo: Geometry,
        fullscreen: bool,
    }

    const SUBCLASS_ID: usize = 0x6C1D;
    static BARS: Mutex<Option<HashMap<isize, State>>> = Mutex::new(None);
    static CALLBACK: OnceLock<u32> = OnceLock::new();
    type Cb = Box<dyn Fn(bool) + Send + Sync>;
    /// Called with true/false when a full-screen app appears/leaves (used to pause work).
    static ON_FULLSCREEN: OnceLock<Cb> = OnceLock::new();
    /// Called when monitors are added/removed/rearranged.
    static ON_DISPLAY: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    fn abd(hwnd: HWND) -> APPBARDATA {
        let mut a = APPBARDATA::default();
        a.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
        a.hWnd = hwnd;
        a
    }

    pub fn on_fullscreen(f: impl Fn(bool) + Send + Sync + 'static) {
        let _ = ON_FULLSCREEN.set(Box::new(f));
    }

    pub fn on_display_change(f: impl Fn() + Send + Sync + 'static) {
        let _ = ON_DISPLAY.set(Box::new(f));
    }

    /// Register a window as a bottom app bar on whatever monitor it's on, and place it.
    pub fn register(hwnd_raw: isize, geo: Geometry) {
        let hwnd = HWND(hwnd_raw as _);
        let msg = *CALLBACK.get_or_init(|| unsafe { RegisterWindowMessageW(w!("GlideDockAppBarMessage")) });
        {
            let mut g = BARS.lock().unwrap();
            let m = g.get_or_insert_with(HashMap::new);
            if m.contains_key(&hwnd_raw) {
                drop(g);
                place(hwnd_raw);
                return;
            }
            m.insert(hwnd_raw, State { geo, fullscreen: false });
        }
        unsafe {
            let mut a = abd(hwnd);
            a.uCallbackMessage = msg;
            SHAppBarMessage(ABM_NEW, &mut a);
            let _ = SetWindowSubclass(hwnd, Some(proc_), SUBCLASS_ID, 0);
        }
        place(hwnd_raw);
    }

    /// New size / margin from settings: re-reserve the space and move every bar.
    pub fn update(geo: Geometry) {
        let keys: Vec<isize> = {
            let mut g = BARS.lock().unwrap();
            let m = g.get_or_insert_with(HashMap::new);
            for s in m.values_mut() {
                s.geo = geo;
            }
            m.keys().copied().collect()
        };
        for k in keys {
            place(k);
        }
    }

    pub fn unregister(hwnd_raw: isize) {
        let had = BARS.lock().unwrap().as_mut().and_then(|m| m.remove(&hwnd_raw)).is_some();
        if had {
            unsafe {
                let hwnd = HWND(hwnd_raw as _);
                let _ = RemoveWindowSubclass(hwnd, Some(proc_), SUBCLASS_ID);
                let mut a = abd(hwnd);
                SHAppBarMessage(ABM_REMOVE, &mut a);
            }
        }
    }

    /// Release every reserved strip (call on quit).
    pub fn unregister_all() {
        let keys: Vec<isize> = BARS.lock().unwrap().as_ref().map(|m| m.keys().copied().collect()).unwrap_or_default();
        for k in keys {
            unregister(k);
        }
    }

    /// Work out the strip to reserve on the bottom of the window's monitor and put the dock inside it.
    fn place(hwnd_raw: isize) {
        let (geo, fullscreen) = match BARS.lock().unwrap().as_ref().and_then(|m| m.get(&hwnd_raw)) {
            Some(s) => (s.geo, s.fullscreen),
            None => return,
        };
        let hwnd = HWND(hwnd_raw as _);
        unsafe {
            let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(mon, &mut mi).as_bool() {
                return;
            }
            let dpi = GetDpiForWindow(hwnd).max(96) as i32;
            let px = |v: u32| (v as i32 * dpi + 48) / 96;
            let (h, m) = (px(geo.height), px(geo.margin));
            let reserve = h + 2 * m;
            let r = mi.rcMonitor;

            let mut a = abd(hwnd);
            a.uEdge = ABE_BOTTOM;
            a.rc = RECT { left: r.left, right: r.right, top: r.bottom - reserve, bottom: r.bottom };
            SHAppBarMessage(ABM_QUERYPOS, &mut a); // Windows may move the strip up to clear other bars
            a.rc.top = a.rc.bottom - reserve;
            SHAppBarMessage(ABM_SETPOS, &mut a);

            let (x, y, w) = (a.rc.left + m, a.rc.top + m, (a.rc.right - a.rc.left) - 2 * m);
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE);
            if !fullscreen {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    }

    unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        let key = hwnd.0 as isize;
        let cb = CALLBACK.get().copied().unwrap_or(0);
        if cb != 0 && msg == cb {
            match wp.0 as u32 {
                ABN_POSCHANGED => place(key),
                ABN_FULLSCREENAPP => {
                    let on = lp.0 != 0;
                    let hide = {
                        let mut g = BARS.lock().unwrap();
                        match g.as_mut().and_then(|m| m.get_mut(&key)) {
                            Some(s) => {
                                s.fullscreen = on;
                                s.geo.hide_in_fullscreen
                            }
                            None => false,
                        }
                    };
                    if hide {
                        let _ = ShowWindow(hwnd, if on { SW_HIDE } else { SW_SHOWNOACTIVATE });
                        if !on {
                            place(key);
                        }
                    }
                    if let Some(f) = ON_FULLSCREEN.get() {
                        f(on && hide);
                    }
                }
                _ => {}
            }
            return LRESULT(0);
        }
        match msg {
            WM_DISPLAYCHANGE => {
                let r = DefSubclassProc(hwnd, msg, wp, lp);
                place(key);
                if let Some(f) = ON_DISPLAY.get() {
                    f();
                }
                return r;
            }
            WM_DPICHANGED => {
                let r = DefSubclassProc(hwnd, msg, wp, lp);
                place(key);
                return r;
            }
            // Windows asks app bars to report these so it can keep the z-order and work area right
            WM_ACTIVATE => {
                let mut a = abd(hwnd);
                SHAppBarMessage(ABM_ACTIVATE, &mut a);
            }
            WM_WINDOWPOSCHANGED => {
                let mut a = abd(hwnd);
                SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut a);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }
}
