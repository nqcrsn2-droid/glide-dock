//! The dock's own windows: one bar per monitor, a single reusable popup above the bar, and the settings window.
//! The popup and settings windows are created on demand and the popup is destroyed after two minutes unused,
//! so their web views don't sit in memory.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

static POPUP_GEN: AtomicU64 = AtomicU64::new(0);
static POPUP: Mutex<(String, Option<Instant>)> = Mutex::new((String::new(), None));

pub fn bars(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(l, _)| l == "bar" || l.starts_with("bar-")).map(|(_, w)| w).collect()
}

/// Make sure there's one bar on the primary monitor and, if wanted, one on each other monitor.
pub fn sync_bars(app: &AppHandle, all_monitors: bool, geo: crate::appbar::Geometry) {
    let primary = app.primary_monitor().ok().flatten();
    // the main bar always lives on the primary monitor
    if let (Some(bar), Some(p)) = (app.get_webview_window("bar"), primary.as_ref()) {
        let pos = p.position();
        let _ = bar.set_position(PhysicalPosition::new(pos.x + 100, pos.y + 100));
        #[cfg(windows)]
        if let Ok(h) = bar.hwnd() {
            crate::appbar::register(h.0 as isize, geo);
        }
    }
    // drop the old extra bars, then create the ones we need
    for w in bars(app) {
        if w.label() != "bar" {
            #[cfg(windows)]
            if let Ok(h) = w.hwnd() {
                crate::appbar::unregister(h.0 as isize);
            }
            let _ = w.destroy();
        }
    }
    let _ = geo;
    if !all_monitors {
        return;
    }
    let Ok(mons) = app.available_monitors() else { return };
    let ppos = primary.as_ref().map(|p| *p.position());
    let mut n = 0;
    for m in mons {
        if Some(*m.position()) == ppos {
            continue;
        }
        n += 1;
        let label = format!("bar-{}", n);
        let Ok(w) = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("bar.html".into()))
            .title("Glide Dock")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .inner_size(800.0, 64.0)
            .build()
        else {
            continue;
        };
        let pos = m.position();
        let _ = w.set_position(PhysicalPosition::new(pos.x + 100, pos.y + 100));
        #[cfg(windows)]
        if let Ok(h) = w.hwnd() {
            crate::appbar::register(h.0 as isize, geo);
        }
    }
}

fn popup_window(app: &AppHandle, route: &str) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window("popup") {
        return Some(w);
    }
    let w = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App(format!("popup.html#{}", route).into()))
        .title("Glide Dock")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .inner_size(360.0, 400.0)
        .build()
        .ok()?;
    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            hide_popup(&app2);
        }
    });
    Some(w)
}

pub fn hide_popup(app: &AppHandle) {
    let Some(w) = app.get_webview_window("popup") else { return };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let _ = w.hide();
    POPUP.lock().unwrap().1 = Some(Instant::now());
    let gen = POPUP_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        if POPUP_GEN.load(Ordering::SeqCst) == gen {
            if let Some(w) = app.get_webview_window("popup") {
                if !w.is_visible().unwrap_or(true) {
                    let _ = w.destroy();
                }
            }
        }
    });
}

/// Show `route` in the popup, centred above `anchor_css` (CSS px from the left of `from`'s bar).
/// Clicking the same widget again closes it.
pub fn show_popup(app: &AppHandle, from: &WebviewWindow, route: &str, anchor_css: f64, width: f64, height: f64) {
    {
        let p = POPUP.lock().unwrap();
        let just_closed = p.1.map(|t| t.elapsed() < Duration::from_millis(250)).unwrap_or(false);
        if just_closed && p.0 == route {
            return; // the click that blurred it was meant to close it
        }
    }
    let existing_visible = app.get_webview_window("popup").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
    if existing_visible && POPUP.lock().unwrap().0 == route {
        hide_popup(app);
        return;
    }
    let Some(w) = popup_window(app, route) else { return };
    POPUP_GEN.fetch_add(1, Ordering::SeqCst);
    *POPUP.lock().unwrap() = (route.to_string(), None);

    let scale = from.scale_factor().unwrap_or(1.0);
    let bar_pos = from.outer_position().unwrap_or_default();
    let (pw, ph) = ((width * scale) as i32, (height * scale) as i32);
    let mut x = bar_pos.x + (anchor_css * scale) as i32 - pw / 2;
    let y = bar_pos.y - ph - (10.0 * scale) as i32;
    if let Ok(Some(m)) = from.current_monitor() {
        let (mx, mw) = (m.position().x, m.size().width as i32);
        let pad = (8.0 * scale) as i32;
        x = x.clamp(mx + pad, mx + mw - pw - pad);
    }
    let _ = w.set_size(LogicalSize::new(width, height));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = app.emit_to("popup", "route", route);
    let _ = w.show();
    let _ = w.set_focus();
    // from a hotkey, Windows may refuse to hand focus to us; the same nudge used for app switching fixes it
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        crate::apps::activate(windows::Win32::Foundation::HWND(h.0 as _));
    }
}

/// Search opens centred above the primary bar (used by the hotkey).
pub fn show_search(app: &AppHandle) {
    if let Some(bar) = app.get_webview_window("bar") {
        let scale = bar.scale_factor().unwrap_or(1.0);
        let w = bar.inner_size().map(|s| s.width as f64 / scale).unwrap_or(1200.0);
        show_popup(app, &bar, "search", w / 2.0, 640.0, 460.0);
    }
}

pub fn open_settings(app: &AppHandle, tab: Option<&str>) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(t) = tab {
            let _ = app.emit_to("settings", "tab", t);
        }
        return;
    }
    let url = format!("settings.html#{}", tab.unwrap_or("appearance"));
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
        .title("Glide Dock settings")
        .inner_size(860.0, 620.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .build();
}
