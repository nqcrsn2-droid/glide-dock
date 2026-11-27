//! Now playing (Spotify, browsers, Media Player, ...) through Windows' media controls, the same source as the
//! volume flyout. Windows raises events when the song or play state changes; no polling.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct MediaState {
    pub has: bool,
    pub title: String,
    pub artist: String,
    pub app: String,
    pub playing: bool,
    pub thumb: Option<String>,
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub fn state() -> MediaState {
    MediaState::default()
}
#[cfg(not(windows))]
pub fn command(_a: &str) {}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter};
    use windows::Foundation::TypedEventHandler;
    type EventRegistrationToken = i64;
    use windows::Media::Control::*;
    use windows::Storage::Streams::DataReader;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static TX: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
    static MGR: OnceLock<GlobalSystemMediaTransportControlsSessionManager> = OnceLock::new();
    static THUMB: Mutex<(String, Option<String>)> = Mutex::new((String::new(), None));
    static LAST: Mutex<Option<MediaState>> = Mutex::new(None);

    fn poke() {
        if let Some(tx) = TX.get() {
            let _ = tx.lock().unwrap().send(());
        }
    }

    fn session() -> Option<GlobalSystemMediaTransportControlsSession> {
        MGR.get()?.GetCurrentSession().ok()
    }

    pub fn state() -> MediaState {
        let mut s = MediaState::default();
        let Some(sess) = session() else { return s };
        s.has = true;
        if let Ok(info) = sess.GetPlaybackInfo() {
            s.playing = info.PlaybackStatus().map(|p| p == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing).unwrap_or(false);
        }
        if let Ok(id) = sess.SourceAppUserModelId() {
            let id = id.to_string();
            s.app = if id.to_lowercase().ends_with(".exe") {
                id.trim_end_matches(".exe").trim_end_matches(".EXE").to_string()
            } else {
                crate::apps::name_of(&format!("shell:AppsFolder\\{}", id))
            };
        }
        if let Ok(props) = sess.TryGetMediaPropertiesAsync().and_then(|op| op.join()) {
            s.title = props.Title().map(|t| t.to_string()).unwrap_or_default();
            s.artist = props.Artist().map(|t| t.to_string()).unwrap_or_default();
            let key = format!("{}|{}|{}", s.app, s.title, s.artist);
            let cached = { THUMB.lock().unwrap().clone() };
            s.thumb = if cached.0 == key {
                cached.1
            } else {
                let t = props.Thumbnail().ok().and_then(read_thumb);
                *THUMB.lock().unwrap() = (key, t.clone());
                t
            };
        }
        s
    }

    fn read_thumb(r: windows::Storage::Streams::IRandomAccessStreamReference) -> Option<String> {
        let stream = r.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()?.min(3 * 1024 * 1024) as u32;
        if size == 0 {
            return None;
        }
        let mime = stream.ContentType().map(|c| c.to_string()).unwrap_or_else(|_| "image/png".into());
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        Some(crate::util::bytes_data_url(if mime.is_empty() { "image/png" } else { &mime }, &buf))
    }

    pub fn command(action: &str) {
        if let Some(sess) = session() {
            let r = match action {
                "toggle" => sess.TryTogglePlayPauseAsync(),
                "next" => sess.TrySkipNextAsync(),
                "prev" => sess.TrySkipPreviousAsync(),
                _ => return,
            };
            if let Ok(op) = r {
                let _ = op.join();
            }
        }
    }

    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        let (tx, rx) = channel::<()>();
        let _ = TX.set(Mutex::new(tx));
        std::thread::Builder::new()
            .name("media".into())
            .spawn(move || {
                crate::util::com();
                let Ok(mgr) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(|o| o.join()) else {
                    return;
                };
                let _ = mgr.CurrentSessionChanged(&TypedEventHandler::new(|_, _| {
                    poke();
                    Ok(())
                }));
                let _ = MGR.set(mgr);
                let mut hooked: Option<(GlobalSystemMediaTransportControlsSession, EventRegistrationToken, EventRegistrationToken)> = None;
                loop {
                    // (re)attach to the current session's change events
                    let cur = session();
                    let same = match (&hooked, &cur) {
                        (Some((a, _, _)), Some(b)) => a == b,
                        (None, None) => true,
                        _ => false,
                    };
                    if !same {
                        if let Some((s, t1, t2)) = hooked.take() {
                            let _ = s.RemoveMediaPropertiesChanged(t1);
                            let _ = s.RemovePlaybackInfoChanged(t2);
                        }
                        if let Some(s) = cur {
                            let t1 = s.MediaPropertiesChanged(&TypedEventHandler::new(|_, _| {
                                poke();
                                Ok(())
                            }));
                            let t2 = s.PlaybackInfoChanged(&TypedEventHandler::new(|_, _| {
                                poke();
                                Ok(())
                            }));
                            if let (Ok(t1), Ok(t2)) = (t1, t2) {
                                hooked = Some((s, t1, t2));
                            }
                        }
                    }
                    let st = state();
                    let changed = {
                        let mut l = LAST.lock().unwrap();
                        if l.as_ref() != Some(&st) {
                            *l = Some(st.clone());
                            true
                        } else {
                            false
                        }
                    };
                    if changed {
                        if let Some(app) = APP.get() {
                            let _ = app.emit("media", &st);
                        }
                    }
                    if rx.recv().is_err() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    while rx.try_recv().is_ok() {}
                }
            })
            .ok();
    }
}
