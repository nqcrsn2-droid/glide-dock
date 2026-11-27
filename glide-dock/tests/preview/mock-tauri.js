// Fake Tauri bridge with sample data, for designing the pages in a normal browser (see shoot.py).
(() => {
  const svg = (c, t) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${c}"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="Segoe UI,Arial">${t}</text></svg>`);
  const S = {
    dock_height: 64, margin: 8, corner_radius: 22, opacity: 0.82, theme: "dark", accent: "#ff4d6d", icon_size: 38, magnify: true,
    left: ["search", "toggles"], right: ["media", "weather", "volume", "cpu", "clock"], toggles: ["wifi", "bluetooth", "dark"],
    pinned: [
      { name: "File Explorer", launch: "C:\\Windows\\explorer.exe", exe: "C:\\Windows\\explorer.exe" },
      { name: "Microsoft Edge", launch: "edge", exe: "edge" },
      { name: "Spotify", launch: "spotify", exe: "spotify" },
      { name: "Discord", launch: "discord", exe: "discord" },
      { name: "Settings", launch: "settings", exe: "" },
    ],
    pins_initialised: true, hide_windows_taskbar: true, hide_in_fullscreen: true, monitors: "primary", search_hotkey: "Alt+Space",
    file_search: true, clock_seconds: false, clock_24h: false, weather_city: "Hot Springs, Arkansas, US", weather_lat: 34.5, weather_lon: -93.05,
    units: "imperial", calendars: ["https://example.com/cal.ics"], world_tz: "Europe/London", currency_from: "USD", currency_to: "EUR",
  };
  const icons = { "C:\\Windows\\explorer.exe": svg("#f5b400", "📁"), edge: svg("#0a7cd6", "e"), spotify: svg("#1db954", "♪"), discord: svg("#5865f2", "d"), settings: svg("#555", "⚙"), code: svg("#2489ca", "{}"), "C:\\Users\\me\\Documents\\budget.xlsx": svg("#1d6f42", "X") };
  const hour = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString().slice(0, 16); };
  const weather = { current: { temperature_2m: 58, apparent_temperature: 55, relative_humidity_2m: 62, weather_code: 2, wind_speed_10m: 7, is_day: 1 },
    hourly: { time: Array.from({ length: 48 }, (_, i) => hour(i)), temperature_2m: Array.from({ length: 48 }, (_, i) => 50 + Math.round(8 * Math.sin(i / 4))), weather_code: Array.from({ length: 48 }, (_, i) => [0, 1, 2, 3, 61, 2][i % 6]), precipitation_probability: Array.from({ length: 48 }, (_, i) => (i % 6 === 4 ? 60 : 5)) },
    daily: { time: Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); }), weather_code: [2, 3, 61, 0, 1, 95, 2], temperature_2m_max: [61, 57, 52, 64, 66, 59, 60], temperature_2m_min: [44, 46, 41, 40, 45, 50, 43], precipitation_probability_max: [5, 20, 80, 0, 5, 70, 10] } };
  const today = new Date(); const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Team sync", `DTSTART:${ymd(today)}T190000Z`, `DTEND:${ymd(today)}T193000Z`, "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Dentist", "LOCATION:Central Ave", `DTSTART:${ymd(today)}T220000Z`, "END:VEVENT", "BEGIN:VEVENT", "SUMMARY:Gym", `DTSTART:${ymd(today)}T120000Z`, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const R = {
    get_settings: () => S, save_settings: (a) => Object.assign(S, a.settings),
    apps_list: () => [
      { target: "C:\\Windows\\explorer.exe", name: "File Explorer", windows: [{ hwnd: 1, title: "Downloads", minimized: false }], active: false },
      { target: "edge", name: "Edge", windows: [{ hwnd: 2, title: "GitHub", minimized: false }, { hwnd: 3, title: "Docs", minimized: false }], active: true },
      { target: "spotify", name: "Spotify", windows: [{ hwnd: 4, title: "Spotify", minimized: false }], active: false },
      { target: "code", name: "Visual Studio Code", windows: [{ hwnd: 5, title: "glide-dock", minimized: false }], active: false },
    ],
    get_icon: (a) => icons[a.target] || svg("#777", "?"),
    audio_state: () => ({ volume: 62, muted: false, mic_muted: false, device: "Speakers (Realtek Audio)" }),
    media_state: () => ({ has: true, title: "Midnight City", artist: "M83", app: "Spotify", playing: true, thumb: svg("#6a3cff", "♫") }),
    timer_get: () => ({ running: false }), toggles_state: () => ({ wifi: true, bluetooth: false, dark: true, keep_awake: false, desktop_icons: true, muted: false, mic_muted: false, taskbar_hidden: true }),
    http_get: (a) => (a.url.includes("open-meteo") ? JSON.stringify(weather) : a.url.includes("frankfurter") ? JSON.stringify({ date: "2026-11-26", rates: { EUR: 0.9231 } }) : ics),
    search_query: (a) => ({ apps: a.q.startsWith("vi") ? [{ name: "Visual Studio Code", launch: "code", exe: "code" }] : [], files: a.q.length > 1 ? [{ name: "budget.xlsx", path: "C:\\Users\\me\\Documents\\budget.xlsx", dir: false }] : [], indexing: false }),
    file_info: (a) => ({ path: a.path, size: 48211, modified: Date.now() / 1000 - 3600, dir: false, preview: icons[a.path] }),
    all_apps: () => [{ name: "Calculator", launch: "calc", exe: "" }, { name: "Discord", launch: "discord", exe: "discord" }, { name: "Microsoft Edge", launch: "edge", exe: "edge" }, { name: "Spotify", launch: "spotify", exe: "spotify" }, { name: "Visual Studio Code", launch: "code", exe: "code" }],
    notes_get: () => "- Buy milk\n- Call Sam back", recycle_info: () => [14, 52428800], app_info: () => ({ version: "0.6.0", portable: false, data: "C:\\Users\\me\\AppData\\Roaming\\app.glidedock" }),
    "plugin:autostart|is_enabled": () => true,
  };
  const listeners = {};
  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => (R[cmd] ? R[cmd](args || {}) : null) },
    event: { listen: async (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => {}; } },
  };
  window.__emit = (ev, payload) => (listeners[ev] || []).forEach((f) => f({ payload }));
  setTimeout(() => window.__emit("stats", { cpu: 14, ram_used_gb: 9.4, ram_total_gb: 16, ram_pct: 59, net_down: 1840000, net_up: 120000, battery: null, charging: false, disk_free_gb: 212, disk_total_gb: 512, uptime_s: 192000 }), 300);
})();
