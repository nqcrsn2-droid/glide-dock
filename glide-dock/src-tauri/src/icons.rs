//! Icons and thumbnails through the Windows shell (the same pictures Explorer shows).
//! Works for .exe, .lnk, any file, and "shell:AppsFolder\<AppID>" for Store apps. Results are cached.

use std::{collections::HashMap, sync::Mutex};

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);
const CACHE_MAX: usize = 400;

/// Icon (48 px, or `size`) as a PNG data URL.
pub fn icon(target: &str, size: i32) -> Option<String> {
    let key = format!("{}|{}", size, target.to_lowercase());
    if let Some(v) = CACHE.lock().unwrap().as_ref().and_then(|m| m.get(&key)) {
        return v.clone();
    }
    let v = image(target, size, true);
    let mut g = CACHE.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    if m.len() > CACHE_MAX {
        m.clear();
    }
    m.insert(key, v.clone());
    v
}

/// Explorer-style thumbnail (photos, videos, PDFs if a handler exists), falling back to the icon. Not cached.
pub fn thumbnail(path: &str, size: i32) -> Option<String> {
    image(path, size, false)
}

#[cfg(windows)]
fn image(target: &str, size: i32, icon_only: bool) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::UI::Shell::*;
    crate::util::com();
    let w = crate::util::wide(target);
    unsafe {
        let f: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None).ok()?;
        let flags = if icon_only { SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK } else { SIIGBF_BIGGERSIZEOK };
        let bmp = f.GetImage(SIZE { cx: size, cy: size }, flags).ok()?;
        crate::util::hbitmap_to_png(bmp)
    }
}

#[cfg(not(windows))]
fn image(_t: &str, _s: i32, _i: bool) -> Option<String> {
    None
}
