//! Small helpers shared by the Windows modules.

use base64::Engine;

/// RGBA pixels -> "data:image/png;base64,..."
pub fn png_data_url(w: u32, h: u32, rgba: &[u8]) -> Option<String> {
    let mut out = Vec::with_capacity(rgba.len() / 3);
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out)))
}

pub fn bytes_data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(windows)]
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Make sure the calling thread has COM (multi-threaded). Safe to call many times.
#[cfg(windows)]
pub fn com() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// Run `f` on a fresh single-threaded-COM thread and wait for it. The Windows shell (launching
/// "shell:AppsFolder" apps, app icons) expects this kind of thread; on others some calls quietly fail.
#[cfg(windows)]
pub fn sta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    std::thread::spawn(move || unsafe {
        let ok = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok();
        let r = f();
        if ok {
            CoUninitialize();
        }
        r
    })
    .join()
    .expect("sta thread")
}

/// HICON -> PNG data URL (the icon itself is not destroyed).
#[cfg(windows)]
pub fn hicon_to_png(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<String> {
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};
    unsafe {
        let mut ii = ICONINFO::default();
        GetIconInfo(icon, &mut ii).ok()?;
        if !ii.hbmMask.is_invalid() {
            let _ = DeleteObject(ii.hbmMask.into());
        }
        if ii.hbmColor.is_invalid() {
            return None;
        }
        hbitmap_to_png(ii.hbmColor)
    }
}

/// HBITMAP (32-bit, usually premultiplied) -> PNG data URL. The bitmap is deleted.
#[cfg(windows)]
pub fn hbitmap_to_png(hbmp: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<String> {
    use windows::Win32::Graphics::Gdi::*;
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(hbmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
            let _ = DeleteObject(hbmp.into());
            return None;
        }
        let (w, h) = (bm.bmWidth.max(1), bm.bmHeight.abs().max(1));
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -h; // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB.0;
        let mut px = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let lines = GetDIBits(dc, hbmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        let _ = DeleteObject(hbmp.into());
        if lines == 0 {
            return None;
        }
        let any_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
        for p in px.chunks_exact_mut(4) {
            let (b, g, r, a) = (p[0], p[1], p[2], if any_alpha { p[3] } else { 255 });
            let un = |c: u8| if a == 0 || a == 255 { c } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
            p[0] = un(r);
            p[1] = un(g);
            p[2] = un(b);
            p[3] = a;
        }
        png_data_url(w as u32, h as u32, &px)
    }
}
