//! Search sources that need the system: installed apps (the same list as Start's "All apps", Store apps included)
//! and a file-name index of your personal folders. Both are built on first use, in the background, and refreshed
//! when they're more than 10 minutes old. Nothing is sent anywhere.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

#[derive(Serialize, Clone, Debug)]
pub struct AppEntry {
    pub name: String,
    /// "shell:AppsFolder\<id>" — always launchable
    pub launch: String,
    /// target .exe when Windows knows it (used to match running windows)
    pub exe: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileHit {
    pub name: String,
    pub path: String,
    pub dir: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub modified: u64,
    pub dir: bool,
    pub preview: Option<String>,
    pub text: Option<String>,
}

struct Index<T> {
    items: Vec<T>,
    built: Option<Instant>,
    building: bool,
}

static APPS: Mutex<Index<AppEntry>> = Mutex::new(Index { items: Vec::new(), built: None, building: false });
static FILES: Mutex<Index<PathBuf>> = Mutex::new(Index { items: Vec::new(), built: None, building: false });
const MAX_FILES: usize = 40_000;
const STALE: Duration = Duration::from_secs(600);

fn stale<T>(i: &Index<T>) -> bool {
    !i.building && i.built.map(|t| t.elapsed() > STALE).unwrap_or(true)
}

/// Start (re)building the indexes if they're missing or old. Returns at once.
pub fn warm(file_search: bool) {
    let need_apps = {
        let mut g = APPS.lock().unwrap();
        let s = stale(&g);
        if s {
            g.building = true;
        }
        s
    };
    if need_apps {
        std::thread::spawn(|| {
            #[cfg(windows)]
            let items = crate::util::sta(list_apps);
            #[cfg(not(windows))]
            let items = list_apps();
            let mut g = APPS.lock().unwrap();
            g.items = items;
            g.built = Some(Instant::now());
            g.building = false;
        });
    }
    if !file_search {
        let mut g = FILES.lock().unwrap();
        g.items = Vec::new();
        g.built = None;
        return;
    }
    let need_files = {
        let mut g = FILES.lock().unwrap();
        let s = stale(&g);
        if s {
            g.building = true;
        }
        s
    };
    if need_files {
        std::thread::spawn(|| {
            let mut items = Vec::new();
            for root in user_folders() {
                walk(&root, 0, &mut items);
                if items.len() >= MAX_FILES {
                    break;
                }
            }
            items.shrink_to_fit();
            let mut g = FILES.lock().unwrap();
            g.items = items;
            g.built = Some(Instant::now());
            g.building = false;
        });
    }
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 6 || out.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = e.file_name();
        let n = name.to_string_lossy();
        if n.starts_with('.') || n.starts_with('$') || n == "node_modules" || n == "desktop.ini" || n == "__pycache__" {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        out.push(e.path());
        if ft.is_dir() {
            walk(&e.path(), depth + 1, out);
        }
    }
}

/// Lower is better. None = no match.
pub fn score(name: &str, q: &str) -> Option<u32> {
    let n = name.to_lowercase();
    if n == q {
        return Some(0);
    }
    if n.starts_with(q) {
        return Some(1);
    }
    if n.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(q)) {
        return Some(2);
    }
    if n.contains(q) {
        return Some(3);
    }
    // initials: "vsc" -> "Visual Studio Code"
    let initials: String = n.split(|c: char| !c.is_alphanumeric()).filter_map(|w| w.chars().next()).collect();
    if q.len() >= 2 && initials.starts_with(q) {
        return Some(2);
    }
    None
}

pub fn search_apps(q: &str, limit: usize) -> Vec<AppEntry> {
    let q = q.trim().to_lowercase();
    let g = APPS.lock().unwrap();
    let mut v: Vec<(u32, &AppEntry)> = g.items.iter().filter_map(|a| score(&a.name, &q).map(|s| (s, a))).collect();
    v.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.name.len().cmp(&b.1.name.len())));
    v.into_iter().take(limit).map(|(_, a)| a.clone()).collect()
}

pub fn all_apps() -> Vec<AppEntry> {
    let mut v = APPS.lock().unwrap().items.clone();
    v.sort_by_key(|a| a.name.to_lowercase());
    v
}

pub fn search_files(q: &str, limit: usize) -> Vec<FileHit> {
    let q = q.trim().to_lowercase();
    if q.len() < 2 {
        return vec![];
    }
    let g = FILES.lock().unwrap();
    let mut v: Vec<(u32, SystemTime, &PathBuf)> = Vec::new();
    for p in &g.items {
        let Some(name) = p.file_name().map(|n| n.to_string_lossy()) else { continue };
        if let Some(s) = score(&name, &q) {
            v.push((s, SystemTime::UNIX_EPOCH, p));
        }
    }
    // newest first within the same match quality; only stat the few we might show
    v.sort_by_key(|x| x.0);
    v.truncate(limit * 4);
    for x in v.iter_mut() {
        x.1 = std::fs::metadata(x.2).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
    }
    v.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    v.into_iter()
        .take(limit)
        .map(|(_, _, p)| FileHit {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
            dir: p.is_dir(),
        })
        .collect()
}

const TEXT_EXT: &[&str] = &["txt", "md", "json", "csv", "log", "ini", "toml", "yaml", "yml", "js", "ts", "py", "rs", "html", "css", "xml"];
const THUMB_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "heic", "mp4", "mov", "mkv", "avi", "pdf"];

pub fn file_info(path: &str) -> FileInfo {
    let p = Path::new(path);
    let mut f = FileInfo { path: path.to_string(), ..Default::default() };
    if let Ok(m) = std::fs::metadata(p) {
        f.size = m.len();
        f.dir = m.is_dir();
        f.modified = m.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if TEXT_EXT.contains(&ext.as_str()) && f.size < 5_000_000 {
        if let Ok(mut file) = std::fs::File::open(p) {
            use std::io::Read;
            let mut buf = vec![0u8; 2000];
            let n = file.read(&mut buf).unwrap_or(0);
            f.text = Some(String::from_utf8_lossy(&buf[..n]).to_string());
        }
    } else if THUMB_EXT.contains(&ext.as_str()) {
        f.preview = crate::icons::thumbnail(path, 256);
    }
    if f.preview.is_none() && f.text.is_none() {
        f.preview = crate::icons::icon(path, 96);
    }
    f
}

#[cfg(windows)]
fn user_folders() -> Vec<PathBuf> {
    use windows::Win32::UI::Shell::*;
    let ids = [FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Pictures, FOLDERID_Videos, FOLDERID_Music];
    let mut v = Vec::new();
    for id in ids {
        unsafe {
            if let Ok(p) = SHGetKnownFolderPath(&id, KF_FLAG_DEFAULT, None) {
                if let Ok(s) = p.to_string() {
                    v.push(PathBuf::from(s));
                }
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            }
        }
    }
    v.dedup();
    v
}

#[cfg(not(windows))]
fn user_folders() -> Vec<PathBuf> {
    std::env::var("HOME").map(|h| vec![PathBuf::from(h)]).unwrap_or_default()
}

/// Every app in Start's "All apps" list (Win32 and Store).
#[cfg(windows)]
fn list_apps() -> Vec<AppEntry> {
    use windows::core::Interface;
    use windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath;
    use windows::Win32::UI::Shell::*;
    crate::util::com();
    let mut out = Vec::new();
    unsafe {
        let Ok(folder) = SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else { return out };
        let Ok(en) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else { return out };
        loop {
            let mut items: [Option<IShellItem>; 1] = [None];
            let mut fetched = 0u32;
            if en.Next(&mut items, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let Some(it) = items[0].take() else { break };
            let name = it.GetDisplayName(SIGDN_NORMALDISPLAY).ok().and_then(|p| {
                let s = p.to_string().ok();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                s
            });
            let id = it.GetDisplayName(SIGDN_PARENTRELATIVEPARSING).ok().and_then(|p| {
                let s = p.to_string().ok();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                s
            });
            let (Some(name), Some(id)) = (name, id) else { continue };
            let low = name.to_lowercase();
            if low.contains("uninstall") || low.starts_with("readme") {
                continue;
            }
            let exe = it
                .cast::<IShellItem2>()
                .ok()
                .and_then(|i2| i2.GetString(&PKEY_Link_TargetParsingPath).ok())
                .and_then(|p| {
                    let s = p.to_string().ok();
                    windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                    s
                })
                .filter(|s| s.to_lowercase().ends_with(".exe"))
                .unwrap_or_default();
            out.push(AppEntry { name, launch: format!("shell:AppsFolder\\{}", id), exe });
        }
    }
    out
}

#[cfg(not(windows))]
fn list_apps() -> Vec<AppEntry> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::score;
    #[test]
    fn scoring() {
        assert_eq!(score("Notepad", "notepad"), Some(0));
        assert_eq!(score("Notepad++", "note"), Some(1));
        assert_eq!(score("Visual Studio Code", "studio"), Some(2));
        assert_eq!(score("Visual Studio Code", "vsc"), Some(2));
        assert_eq!(score("Calculator", "ulat"), Some(3));
        assert_eq!(score("Calculator", "xyz"), None);
    }
}
