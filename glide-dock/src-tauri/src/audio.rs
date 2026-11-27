//! Speaker volume / mute and microphone mute through Windows Core Audio.
//! Windows calls us when the volume changes (keyboard keys, other apps) or the default device changes; no polling.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct AudioState {
    pub volume: u32,
    pub muted: bool,
    pub mic_muted: bool,
    pub device: String,
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub fn state() -> AudioState {
    AudioState::default()
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter};
    use windows::core::{implement, Result, PCWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::*;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static TX: OnceLock<Mutex<Sender<()>>> = OnceLock::new();

    fn enumerator() -> Option<IMMDeviceEnumerator> {
        crate::util::com();
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok() }
    }

    fn device(flow: EDataFlow) -> Option<IMMDevice> {
        unsafe { enumerator()?.GetDefaultAudioEndpoint(flow, eConsole).ok() }
    }

    fn endpoint(flow: EDataFlow) -> Option<IAudioEndpointVolume> {
        unsafe { device(flow)?.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok() }
    }

    fn device_name(d: &IMMDevice) -> String {
        unsafe {
            d.OpenPropertyStore(STGM_READ)
                .and_then(|s| s.GetValue(&PKEY_Device_FriendlyName))
                .map(|v| v.to_string())
                .unwrap_or_default()
        }
    }

    pub fn state() -> AudioState {
        let mut s = AudioState::default();
        unsafe {
            if let Some(d) = device(eRender) {
                s.device = device_name(&d);
                if let Ok(ep) = d.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                    s.volume = (ep.GetMasterVolumeLevelScalar().unwrap_or(0.0) * 100.0).round() as u32;
                    s.muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                }
            }
            if let Some(ep) = endpoint(eCapture) {
                s.mic_muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            }
        }
        s
    }

    pub fn set_volume(v: u32) {
        if let Some(ep) = endpoint(eRender) {
            unsafe {
                let _ = ep.SetMasterVolumeLevelScalar(v.min(100) as f32 / 100.0, std::ptr::null());
                if v > 0 {
                    let _ = ep.SetMute(false, std::ptr::null());
                }
            }
        }
    }

    pub fn set_mute(m: bool) {
        if let Some(ep) = endpoint(eRender) {
            unsafe {
                let _ = ep.SetMute(m, std::ptr::null());
            }
        }
    }

    pub fn set_mic_mute(m: bool) {
        if let Some(ep) = endpoint(eCapture) {
            unsafe {
                let _ = ep.SetMute(m, std::ptr::null());
            }
        }
        emit();
    }

    fn emit() {
        if let Some(app) = APP.get() {
            let _ = app.emit("audio", state());
        }
    }

    fn poke() {
        if let Some(tx) = TX.get() {
            let _ = tx.lock().unwrap().send(());
        }
    }

    #[implement(IAudioEndpointVolumeCallback)]
    struct VolumeCb;
    impl IAudioEndpointVolumeCallback_Impl for VolumeCb_Impl {
        fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
            emit();
            Ok(())
        }
    }

    #[implement(IMMNotificationClient)]
    struct DeviceCb;
    impl IMMNotificationClient_Impl for DeviceCb_Impl {
        fn OnDeviceStateChanged(&self, _id: &PCWSTR, _state: DEVICE_STATE) -> Result<()> {
            Ok(())
        }
        fn OnDeviceAdded(&self, _id: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDeviceRemoved(&self, _id: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _id: &PCWSTR) -> Result<()> {
            if role == eConsole && (flow == eRender || flow == eCapture) {
                poke();
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _id: &PCWSTR, _key: &PROPERTYKEY) -> Result<()> {
            Ok(())
        }
    }

    /// One small thread owns the COM callbacks and re-attaches them when the default device changes.
    pub fn start(app: AppHandle) {
        let _ = APP.set(app);
        let (tx, rx) = channel::<()>();
        let _ = TX.set(Mutex::new(tx));
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || unsafe {
                crate::util::com();
                let Some(en) = enumerator() else { return };
                let dev_cb: IMMNotificationClient = DeviceCb.into();
                let _ = en.RegisterEndpointNotificationCallback(&dev_cb);
                let vol_cb: IAudioEndpointVolumeCallback = VolumeCb.into();
                let mut current: Option<IAudioEndpointVolume> = None;
                loop {
                    if let Some(old) = current.take() {
                        let _ = old.UnregisterControlChangeNotify(&vol_cb);
                    }
                    if let Some(ep) = endpoint(eRender) {
                        let _ = ep.RegisterControlChangeNotify(&vol_cb);
                        current = Some(ep);
                    }
                    emit();
                    if rx.recv().is_err() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    while rx.try_recv().is_ok() {}
                }
            })
            .ok();
    }
}
