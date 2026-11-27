//! Tray icon: the always-available way out. Even if the bar is hidden or broken, the user can restore the
//! Windows taskbar, open settings or quit from here.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "tray:settings", "Settings…", true, None::<&str>)?;
    let search = MenuItem::with_id(app, "tray:search", "Search", true, None::<&str>)?;
    let restore = MenuItem::with_id(app, "tray:restore", "Restore Windows taskbar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray:quit", "Quit Glide Dock", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &search, &restore, &sep, &quit])?;

    let mut tb = TrayIconBuilder::with_id("glide-dock")
        .tooltip("Glide Dock")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "tray:settings" => crate::windows_mgr::open_settings(app, None),
            "tray:search" => crate::windows_mgr::show_search(app),
            "tray:restore" => {
                if let Some(st) = app.try_state::<crate::AppState>() {
                    let mut s = st.settings.lock().unwrap().clone();
                    s.hide_windows_taskbar = false;
                    let _ = s.save(&st.dir);
                    *st.settings.lock().unwrap() = s;
                    crate::taskbar::restore(&st.dir);
                }
            }
            "tray:quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tb = tb.icon(icon.clone());
    }
    tb.build(app)?;
    Ok(())
}
