//! User settings, saved as JSON in the data folder (%APPDATA%\app.glidedock, or .\data in portable mode).
//! Unknown or missing fields fall back to defaults, so older files keep working after updates.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Pin {
    pub name: String,
    /// What to open: an .exe / .lnk path or "shell:AppsFolder\<AppID>".
    pub launch: String,
    /// The program's .exe, used to match running windows to the pin (may be empty for Store apps).
    #[serde(default)]
    pub exe: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    // look
    pub dock_height: u32,
    pub margin: u32,
    pub corner_radius: u32,
    pub opacity: f32,
    pub theme: String,
    pub accent: String,
    pub icon_size: u32,
    pub magnify: bool,
    // layout: widget ids, left and right of the apps
    pub left: Vec<String>,
    pub right: Vec<String>,
    /// quick-toggle pills shown in the bar (ids from the Quick Toggles panel)
    pub toggles: Vec<String>,
    pub pinned: Vec<Pin>,
    pub pins_initialised: bool,
    // behaviour
    pub hide_windows_taskbar: bool,
    pub hide_in_fullscreen: bool,
    /// "primary" or "all"
    pub monitors: String,
    pub search_hotkey: String,
    pub file_search: bool,
    pub clock_seconds: bool,
    pub clock_24h: bool,
    // data widgets
    pub weather_city: String,
    pub weather_lat: f64,
    pub weather_lon: f64,
    /// "metric" or "imperial"
    pub units: String,
    pub calendars: Vec<String>,
    pub world_tz: String,
    pub currency_from: String,
    pub currency_to: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            dock_height: 64,
            margin: 8,
            corner_radius: 22,
            opacity: 0.82,
            theme: "dark".into(),
            accent: "#ff4d6d".into(),
            icon_size: 38,
            magnify: true,
            left: vec!["search".into(), "toggles".into()],
            right: vec!["media".into(), "weather".into(), "volume".into(), "clock".into()],
            toggles: vec!["wifi".into(), "bluetooth".into(), "dark".into()],
            pinned: vec![],
            pins_initialised: false,
            hide_windows_taskbar: true,
            hide_in_fullscreen: true,
            monitors: "primary".into(),
            search_hotkey: "Alt+Space".into(),
            file_search: true,
            clock_seconds: false,
            clock_24h: false,
            weather_city: String::new(),
            weather_lat: 0.0,
            weather_lon: 0.0,
            units: "imperial".into(),
            calendars: vec![],
            world_tz: "Europe/London".into(),
            currency_from: "USD".into(),
            currency_to: "EUR".into(),
        }
    }
}

impl Settings {
    pub fn path(dir: &PathBuf) -> PathBuf {
        dir.join("settings.json")
    }

    pub fn load(dir: &PathBuf) -> Self {
        let mut s: Settings = fs::read_to_string(Self::path(dir))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        s.clamp();
        s
    }

    /// Keep values inside sane ranges, whatever the file says.
    pub fn clamp(&mut self) {
        if !self.pins_initialised {
            self.pinned = default_pins();
            self.pins_initialised = true;
        }
        self.dock_height = self.dock_height.clamp(44, 120);
        self.margin = self.margin.clamp(0, 40);
        self.corner_radius = self.corner_radius.clamp(0, 60);
        self.opacity = self.opacity.clamp(0.2, 1.0);
        self.icon_size = self.icon_size.clamp(24, self.dock_height.saturating_sub(10).max(24));
        if self.theme != "light" && self.theme != "auto" {
            self.theme = "dark".into();
        }
        if self.monitors != "all" {
            self.monitors = "primary".into();
        }
        if self.units != "metric" {
            self.units = "imperial".into();
        }
        let ok = self.accent.len() == 7
            && self.accent.starts_with('#')
            && self.accent[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !ok {
            self.accent = Settings::default().accent;
        }
        let clean = |v: &mut Vec<String>| {
            v.retain(|s| !s.is_empty() && s.len() < 40);
            v.truncate(24);
        };
        clean(&mut self.left);
        clean(&mut self.right);
        clean(&mut self.toggles);
        self.toggles.truncate(4);
        self.pinned.truncate(40);
        self.calendars.retain(|u| u.starts_with("https://") || u.starts_with("webcal://"));
        self.calendars.truncate(10);
        self.currency_from = self.currency_from.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).take(3).collect();
        self.currency_to = self.currency_to.to_uppercase().chars().filter(|c| c.is_ascii_alphabetic()).take(3).collect();
    }

    /// Atomic save: write a temp file, then rename over the old one.
    pub fn save(&self, dir: &PathBuf) -> std::io::Result<()> {
        fs::create_dir_all(dir)?;
        let tmp = dir.join("settings.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        fs::rename(tmp, Self::path(dir))
    }
}

fn default_pins() -> Vec<Pin> {
    let mut v = vec![];
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let explorer = format!("{}\\explorer.exe", windir);
    v.push(Pin { name: "File Explorer".into(), launch: explorer.clone(), exe: explorer });
    for (name, p) in [
        ("Microsoft Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"),
        ("Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
    ] {
        if std::path::Path::new(p).exists() {
            v.push(Pin { name: name.into(), launch: p.into(), exe: p.into() });
        }
    }
    v.push(Pin {
        name: "Settings".into(),
        launch: "shell:AppsFolder\\windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel".into(),
        exe: String::new(),
    });
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_bad_values() {
        let mut s = Settings { dock_height: 5, opacity: 9.0, accent: "red".into(), theme: "x".into(), ..Default::default() };
        s.calendars = vec!["http://insecure".into(), "https://ok.example/a.ics".into()];
        s.clamp();
        assert_eq!(s.dock_height, 44);
        assert_eq!(s.opacity, 1.0);
        assert_eq!(s.accent, "#ff4d6d");
        assert_eq!(s.theme, "dark");
        assert_eq!(s.calendars.len(), 1);
    }

    #[test]
    fn old_file_still_loads() {
        let s: Settings = serde_json::from_str(r#"{"dock_height":70,"unknown_field":1}"#).unwrap();
        assert_eq!(s.dock_height, 70);
        assert_eq!(s.right, Settings::default().right);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("gd-test-{}", std::process::id()));
        let mut s = Settings::default();
        s.dock_height = 80;
        s.save(&dir).unwrap();
        let l = Settings::load(&dir);
        assert_eq!(l.dock_height, 80);
        assert!(l.pins_initialised);
        let _ = std::fs::remove_dir_all(dir);
    }
}
