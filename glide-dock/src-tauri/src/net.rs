//! Web requests for the weather, currency and calendar widgets, through Windows' own HTTP stack
//! (no extra TLS library in the app). Only these hosts and the user's own calendar links are allowed.

const HOSTS: &[&str] = &[
    "api.open-meteo.com",
    "geocoding-api.open-meteo.com",
    "api.frankfurter.dev",
    "api.frankfurter.app",
];

pub fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?.split(':').next()?;
    Some(host.to_lowercase())
}

/// `calendars` are the ICS links the user typed into settings.
pub fn allowed(url: &str, calendars: &[String]) -> bool {
    let norm = |u: &str| u.replacen("webcal://", "https://", 1);
    if calendars.iter().any(|c| norm(c) == url) {
        return true;
    }
    match host_of(url) {
        Some(h) => HOSTS.contains(&h.as_str()),
        None => false,
    }
}

#[cfg(windows)]
pub fn get(url: &str) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Web::Http::HttpClient;
    crate::util::com();
    let client = HttpClient::new().map_err(|e| e.to_string())?;
    if let Ok(h) = client.DefaultRequestHeaders() {
        let _ = h.UserAgent().and_then(|ua| ua.TryParseAdd(&HSTRING::from("GlideDock/0.6")));
    }
    let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(|e| e.to_string())?;
    let body = client.GetStringAsync(&uri).map_err(|e| e.to_string())?.join().map_err(|e| e.message().to_string())?;
    if body.len() > 4 * 1024 * 1024 {
        return Err("response too large".into());
    }
    Ok(body.to_string())
}

#[cfg(not(windows))]
pub fn get(_url: &str) -> Result<String, String> {
    Err("not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allow_list() {
        assert!(allowed("https://api.open-meteo.com/v1/forecast?x=1", &[]));
        assert!(!allowed("http://api.open-meteo.com/v1/forecast", &[]));
        assert!(!allowed("https://evil.example/?api.open-meteo.com", &[]));
        assert!(!allowed("https://api.open-meteo.com.evil.example/", &[]));
        assert!(!allowed("https://user@evil.example/", &[]));
        let cals = vec!["webcal://cal.example/me.ics".to_string()];
        assert!(allowed("https://cal.example/me.ics", &cals));
        assert!(!allowed("https://cal.example/other.ics", &cals));
    }
}
