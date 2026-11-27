//! Glide Dock: Rust does the system work, the dock's web pages only draw.

mod appbar;
mod apps;
mod audio;
mod icons;
mod media;
mod net;
mod search;
mod settings;
mod sysinfo;
mod system;
mod taskbar;
mod tray;
mod util;
mod windows_mgr;

use serde::Serialize;
use settings::{Pin, Settings};
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    pub dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub timer: Mutex<serde_json::Value>,
}

type Res<T> = Result<T, String>;

// ---------------------------------------------------------------- data folder

/// %APPDATA%\app.glidedock, or a "data" folder next to the exe when "portable.txt" sits beside it.
pub fn data_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            if d.join("portable.txt").exists() || d.join("portable").exists() {
                return d.join("data");
            }
        }
    }
    std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir()).join("app.glidedock")
}

pub fn is_portable() -> bool {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("portable.txt").exists())).unwrap_or(false)
}

// ---------------------------------------------------------------- settings

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, mut settings: Settings) -> Res<Settings> {
    settings.clamp();
    settings.save(&state.dir).map_err(|e| e.to_string())?;
    let old = std::mem::replace(&mut *state.settings.lock().unwrap(), settings.clone());
    apply(&app, &state.dir, &old, &settings);
    Ok(settings)
}

fn geometry(s: &Settings) -> appbar::Geometry {
    appbar::Geometry { height: s.dock_height, margin: s.margin, hide_in_fullscreen: s.hide_in_fullscreen }
}

/// Apply changed settings to the system side and tell every window to redraw.
fn apply(app: &AppHandle, dir: &PathBuf, old: &Settings, new: &Settings) {
    #[cfg(windows)]
    appbar::update(geometry(new));
    if old.monitors != new.monitors {
        windows_mgr::sync_bars(app, new.monitors == "all", geometry(new));
    }
    if old.hide_windows_taskbar != new.hide_windows_taskbar {
        if new.hide_windows_taskbar {
            taskbar::hide(dir);
        } else {
            taskbar::restore(dir);
        }
    }
    if old.search_hotkey != new.search_hotkey {
        register_hotkey(app, &new.search_hotkey);
    }
    if old.file_search != new.file_search && !new.file_search {
        search::warm(false);
    }
    let _ = app.emit("settings", new);
}

fn register_hotkey(app: &AppHandle, key: &str) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !key.trim().is_empty() {
        if let Err(e) = gs.register(key) {
            eprintln!("hotkey {key}: {e}");
        }
    }
}

#[tauri::command]
fn open_settings(app: AppHandle, tab: Option<String>) {
    windows_mgr::open_settings(&app, tab.as_deref());
}

#[tauri::command]
fn open_data_folder(state: State<AppState>) {
    #[cfg(windows)]
    apps::launch(&state.dir.to_string_lossy());
    let _ = state;
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "portable": is_portable(), "data": data_dir() })
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------- apps

#[tauri::command]
async fn apps_list() -> Vec<apps::RunningApp> {
    apps::list()
}

#[tauri::command]
async fn app_click(target: String) {
    #[cfg(windows)]
    apps::click(&target);
    let _ = target;
}

#[tauri::command]
async fn app_launch(target: String) {
    #[cfg(windows)]
    apps::launch(&target);
    let _ = target;
}

#[tauri::command]
async fn get_icon(target: String, size: Option<i32>) -> Option<String> {
    icons::icon(&target, size.unwrap_or(48).clamp(16, 256))
}

static MENU_CTX: Mutex<Option<(Pin, Vec<i64>)>> = Mutex::new(None);

/// Native right-click menu for a dock icon.
#[tauri::command]
fn app_menu(app: AppHandle, window: WebviewWindow, state: State<AppState>, pin: Pin) -> Res<()> {
    let running = apps::list();
    let key_l = pin.launch.to_lowercase();
    let key_e = pin.exe.to_lowercase();
    let wins: Vec<apps::AppWin> = running
        .iter()
        .filter(|a| {
            let t = a.target.to_lowercase();
            t == key_l || (!key_e.is_empty() && t == key_e)
        })
        .flat_map(|a| a.windows.clone())
        .collect();
    let pinned = state.settings.lock().unwrap().pinned.iter().any(|p| p.launch.to_lowercase() == key_l);
    let e = |x: tauri::Error| x.to_string();
    let menu = Menu::new(&app).map_err(e)?;
    for w in wins.iter().take(12) {
        let mut t = w.title.clone();
        if t.chars().count() > 48 {
            t = t.chars().take(47).collect::<String>() + "…";
        }
        menu.append(&MenuItem::with_id(&app, format!("app:win:{}", w.hwnd), t, true, None::<&str>).map_err(e)?).map_err(e)?;
    }
    if !wins.is_empty() {
        menu.append(&PredefinedMenuItem::separator(&app).map_err(e)?).map_err(e)?;
    }
    let title = if wins.is_empty() { format!("Open {}", pin.name) } else { "Open new window".to_string() };
    menu.append(&MenuItem::with_id(&app, "app:new", title, true, None::<&str>).map_err(e)?).map_err(e)?;
    let (pid, plabel) = if pinned { ("app:unpin", "Unpin from dock") } else { ("app:pin", "Pin to dock") };
    menu.append(&MenuItem::with_id(&app, pid, plabel, true, None::<&str>).map_err(e)?).map_err(e)?;
    if !wins.is_empty() {
        let label = if wins.len() > 1 { "Close all windows" } else { "Close window" };
        menu.append(&MenuItem::with_id(&app, "app:close", label, true, None::<&str>).map_err(e)?).map_err(e)?;
    }
    *MENU_CTX.lock().unwrap() = Some((pin, wins.iter().map(|w| w.hwnd).collect()));
    window.popup_menu(&menu).map_err(e)
}

/// Right-click on empty bar space.
#[tauri::command]
fn bar_menu(app: AppHandle, window: WebviewWindow) -> Res<()> {
    let e = |x: tauri::Error| x.to_string();
    let menu = Menu::with_items(
        &app,
        &[
            &MenuItem::with_id(&app, "bar:settings", "Dock settings…", true, None::<&str>).map_err(e)?,
            &MenuItem::with_id(&app, "bar:widgets", "Widget library…", true, None::<&str>).map_err(e)?,
            &PredefinedMenuItem::separator(&app).map_err(e)?,
            &MenuItem::with_id(&app, "bar:taskmgr", "Task Manager", true, None::<&str>).map_err(e)?,
            &MenuItem::with_id(&app, "bar:restore", "Restore Windows taskbar", true, None::<&str>).map_err(e)?,
            &PredefinedMenuItem::separator(&app).map_err(e)?,
            &MenuItem::with_id(&app, "bar:quit", "Quit Glide Dock", true, None::<&str>).map_err(e)?,
        ],
    )
    .map_err(e)?;
    window.popup_menu(&menu).map_err(e)
}

fn on_menu(app: &AppHandle, id: &str) {
    let st = app.state::<AppState>();
    match id {
        "bar:settings" => windows_mgr::open_settings(app, None),
        "bar:widgets" => windows_mgr::open_settings(app, Some("widgets")),
        "bar:taskmgr" => {
            #[cfg(windows)]
            apps::launch("taskmgr.exe");
        }
        "bar:restore" => {
            let mut s = st.settings.lock().unwrap().clone();
            s.hide_windows_taskbar = false;
            let _ = save_settings(app.clone(), st.clone(), s);
        }
        "bar:quit" => app.exit(0),
        _ if id.starts_with("app:") => {
            #[allow(unused_variables)]
            let Some((pin, hwnds)) = MENU_CTX.lock().unwrap().clone() else { return };
            match id {
                "app:new" => {
                    #[cfg(windows)]
                    apps::launch(&pin.launch);
                }
                "app:pin" | "app:unpin" => {
                    let mut s = st.settings.lock().unwrap().clone();
                    let k = pin.launch.to_lowercase();
                    s.pinned.retain(|p| p.launch.to_lowercase() != k);
                    if id == "app:pin" {
                        s.pinned.push(pin.clone());
                    }
                    let _ = save_settings(app.clone(), st.clone(), s);
                }
                "app:close" => {
                    #[cfg(windows)]
                    for h in hwnds {
                        apps::close(windows::Win32::Foundation::HWND(h as _));
                    }
                }
                _ => {
                    if let Some(h) = id.strip_prefix("app:win:").and_then(|h| h.parse::<i64>().ok()) {
                        #[cfg(windows)]
                        apps::activate(windows::Win32::Foundation::HWND(h as _));
                        let _ = h;
                    }
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------- audio / media / stats

#[tauri::command]
async fn audio_state() -> audio::AudioState {
    audio::state()
}

#[tauri::command]
async fn set_volume(volume: u32) {
    #[cfg(windows)]
    audio::set_volume(volume);
    let _ = volume;
}

#[tauri::command]
async fn set_mute(muted: bool) {
    #[cfg(windows)]
    audio::set_mute(muted);
    let _ = muted;
}

#[tauri::command]
async fn media_state() -> media::MediaState {
    media::state()
}

#[tauri::command]
async fn media_cmd(action: String) {
    media::command(&action);
}

#[tauri::command]
fn stats_enable(window: WebviewWindow, on: bool) {
    let flag = if window.label() == "popup" { &sysinfo::WANTED_POPUP } else { &sysinfo::WANTED };
    flag.store(on, std::sync::atomic::Ordering::Relaxed);
}

// ---------------------------------------------------------------- toggles & actions

#[tauri::command]
async fn toggles_state(state: State<'_, AppState>) -> Res<system::ToggleState> {
    let hidden = state.settings.lock().unwrap().hide_windows_taskbar;
    Ok(system::state(hidden))
}

/// Returns false when the switch couldn't be changed (e.g. no Bluetooth radio).
#[tauri::command]
async fn toggle(app: AppHandle, state: State<'_, AppState>, id: String, on: bool) -> Res<bool> {
    #[cfg(windows)]
    {
        let ok = match id.as_str() {
            "wifi" | "bluetooth" => system::set_radio(&id, on),
            "dark" => {
                system::set_dark(on);
                true
            }
            "keepawake" => {
                // execution state belongs to a thread, so keep it on the long-lived main thread
                let _ = app.run_on_main_thread(move || system::set_keep_awake(on));
                true
            }
            "desktop" => {
                system::set_desktop_icons(on);
                true
            }
            "mute" => {
                audio::set_mute(on);
                true
            }
            "mic" => {
                audio::set_mic_mute(on);
                true
            }
            "taskbar" => {
                let mut s = state.settings.lock().unwrap().clone();
                s.hide_windows_taskbar = on;
                save_settings(app.clone(), state.clone(), s).is_ok()
            }
            other => {
                if let Some(uri) = system::settings_uri(other) {
                    apps::launch(uri);
                }
                true
            }
        };
        let _ = app.emit("toggles-changed", ());
        return Ok(ok);
    }
    #[allow(unreachable_code)]
    {
        let _ = (app, state, id, on);
        Ok(false)
    }
}

#[tauri::command]
async fn system_action(action: String) {
    #[cfg(windows)]
    match action.as_str() {
        "lock" => system::lock(),
        "desktop" => system::show_desktop(),
        "screenshot" => apps::launch("ms-screenclip:"),
        "sleep" | "restart" | "shutdown" | "signout" => system::power(&action),
        "recycle-empty" => system::empty_recycle(),
        "recycle-open" => apps::launch("shell:RecycleBinFolder"),
        "downloads" => apps::launch("shell:Downloads"),
        "taskmgr" => apps::launch("taskmgr.exe"),
        other => {
            if let Some(uri) = system::settings_uri(other) {
                apps::launch(uri);
            }
        }
    }
    let _ = action;
}

#[tauri::command]
async fn recycle_info() -> (i64, i64) {
    #[cfg(windows)]
    return system::recycle_info();
    #[allow(unreachable_code)]
    (0, 0)
}

// ---------------------------------------------------------------- web, search, files

#[tauri::command]
async fn http_get(state: State<'_, AppState>, url: String) -> Res<String> {
    let cals = state.settings.lock().unwrap().calendars.clone();
    let url = url.replacen("webcal://", "https://", 1);
    if !net::allowed(&url, &cals) {
        return Err("address not allowed".into());
    }
    net::get(&url)
}

#[tauri::command]
fn open_url(url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        #[cfg(windows)]
        apps::launch(&url);
    }
}

#[derive(Serialize)]
struct SearchResult {
    apps: Vec<search::AppEntry>,
    files: Vec<search::FileHit>,
    indexing: bool,
}

#[tauri::command]
async fn search_query(state: State<'_, AppState>, q: String) -> Res<SearchResult> {
    let fs = state.settings.lock().unwrap().file_search;
    search::warm(fs);
    let apps = search::search_apps(&q, 6);
    let files = if fs { search::search_files(&q, 6) } else { vec![] };
    Ok(SearchResult { indexing: apps.is_empty() && search::all_apps().is_empty(), apps, files })
}

#[tauri::command]
async fn search_warm(state: State<'_, AppState>) -> Res<()> {
    let fs = state.settings.lock().unwrap().file_search;
    search::warm(fs);
    Ok(())
}

#[tauri::command]
async fn all_apps(state: State<'_, AppState>) -> Res<Vec<search::AppEntry>> {
    let fs = state.settings.lock().unwrap().file_search;
    search::warm(fs);
    Ok(search::all_apps())
}

#[tauri::command]
async fn file_info(path: String) -> search::FileInfo {
    search::file_info(&path)
}

#[tauri::command]
async fn open_path(path: String, reveal: Option<bool>) {
    #[cfg(windows)]
    {
        if reveal.unwrap_or(false) {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("explorer.exe").raw_arg(format!("/select,\"{}\"", path)).spawn();
        } else {
            apps::launch(&path);
        }
    }
    let _ = (path, reveal);
}

// ---------------------------------------------------------------- popups, notes, timer

#[tauri::command]
fn show_popup(app: AppHandle, window: WebviewWindow, route: String, anchor: f64, width: f64, height: f64) {
    let (w, h) = (width.clamp(200.0, 900.0), height.clamp(120.0, 800.0));
    windows_mgr::show_popup(&app, &window, &route, anchor, w, h);
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    windows_mgr::hide_popup(&app);
}

#[tauri::command]
fn notes_get(state: State<AppState>) -> String {
    std::fs::read_to_string(state.dir.join("notes.md")).unwrap_or_default()
}

#[tauri::command]
fn notes_set(state: State<AppState>, text: String) -> Res<()> {
    if text.len() > 1_000_000 {
        return Err("note too long".into());
    }
    std::fs::write(state.dir.join("notes.md"), text).map_err(|e| e.to_string())
}

#[tauri::command]
fn timer_get(state: State<AppState>) -> serde_json::Value {
    state.timer.lock().unwrap().clone()
}

#[tauri::command]
fn timer_set(app: AppHandle, state: State<AppState>, value: serde_json::Value) {
    *state.timer.lock().unwrap() = value.clone();
    let _ = app.emit("timer", value);
}

// ---------------------------------------------------------------- start-up

/// `--cleanup` (used by the uninstaller): put the taskbar back and remove the start-up entry, then exit.
fn cli(dir: &PathBuf) -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--restore-taskbar" || a == "--cleanup") {
        taskbar::restore(dir);
        if args.iter().any(|a| a == "--cleanup") {
            #[cfg(windows)]
            unsafe {
                use windows::core::w;
                use windows::Win32::System::Registry::*;
                let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), w!("Glide Dock"));
            }
        }
        return true;
    }
    false
}

pub fn run() {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    if cli(&dir) {
        return;
    }
    // a previous crash or power cut may have left the taskbar changed: fix that before anything else
    taskbar::recover(&dir);
    // and if we ever panic, put it back on the way down
    let panic_dir = dir.clone();
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        taskbar::restore(&panic_dir);
        prev(info);
    }));

    let app = tauri::Builder::default()
        // must be first: launching the app again opens the settings window instead of a second dock
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| windows_mgr::open_settings(app, None)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, ev| {
                    if ev.state == ShortcutState::Pressed {
                        windows_mgr::show_search(app);
                    }
                })
                .build(),
        )
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, open_settings, open_data_folder, app_info, quit,
            apps_list, app_click, app_launch, get_icon, app_menu, bar_menu,
            audio_state, set_volume, set_mute, media_state, media_cmd, stats_enable,
            toggles_state, toggle, system_action, recycle_info,
            http_get, open_url, search_query, search_warm, all_apps, file_info, open_path,
            show_popup, hide_popup, notes_get, notes_set, timer_get, timer_set
        ])
        .setup(move |app| {
            let first_run = !Settings::path(&dir).exists();
            let settings = Settings::load(&dir);
            let _ = settings.save(&dir);

            if first_run && !is_portable() {
                let _ = app.autolaunch().enable();
            }

            // dock the bars
            #[cfg(windows)]
            {
                let h = app.handle().clone();
                appbar::on_fullscreen(move |hidden| {
                    sysinfo::PAUSED.store(hidden, std::sync::atomic::Ordering::Relaxed);
                    apps::pause(hidden);
                    let _ = h.emit("fullscreen", hidden);
                });
                let h = app.handle().clone();
                appbar::on_display_change(move || {
                    // let Windows finish rearranging first, then rebuild outside the window procedure
                    let h = h.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        let h2 = h.clone();
                        let _ = h.run_on_main_thread(move || {
                            let s = h2.state::<AppState>().settings.lock().unwrap().clone();
                            if s.monitors == "all" {
                                windows_mgr::sync_bars(&h2, true, geometry(&s));
                            }
                        });
                    });
                });
            }
            windows_mgr::sync_bars(app.handle(), settings.monitors == "all", geometry(&settings));
            #[cfg(not(windows))]
            if let Some(b) = app.get_webview_window("bar") {
                let _ = b.show();
            }

            if settings.hide_windows_taskbar {
                taskbar::hide(&dir);
            }
            register_hotkey(app.handle(), &settings.search_hotkey);

            app.manage(AppState {
                dir: dir.clone(),
                settings: Mutex::new(settings),
                timer: Mutex::new(serde_json::json!({ "running": false })),
            });

            // event sources
            #[cfg(windows)]
            {
                apps::start(app.handle().clone());
                audio::start(app.handle().clone());
                media::start(app.handle().clone());
            }
            sysinfo::start(app.handle().clone());
            tray::build(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Glide Dock");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            #[cfg(windows)]
            appbar::unregister_all();
            if let Some(st) = app.try_state::<AppState>() {
                taskbar::restore(&st.dir);
                #[cfg(windows)]
                if system::keep_awake() {
                    system::set_keep_awake(false);
                }
            }
        }
    });
}
