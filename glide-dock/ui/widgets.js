// The widget library: everything that can sit on the bar, left or right of the apps.
// Each widget returns plain HTML; the bar re-draws a widget only when one of its `events` arrives.
(() => {
  const { esc, fmtRate, fmtDur, timeStr, wmo } = window.GD;

  // Simple stroke icons (24px grid)
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5 12a10 10 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
    moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
    coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M8 2v3M12 2v3"/>',
    speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micoff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    taskbar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    focus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    plane: '<path d="M10 14l-7-3 1-2 8 1 4-6a1.5 1.5 0 0 1 2.5 1.5L15 11l1 8-2 1-3-7"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l7-7"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
    next: '<path d="M5 4l10 8-10 8zM18 4v16"/>',
    prev: '<path d="M19 4L9 12l10 8zM6 4v16"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    ram: '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 17v3M10 17v3M14 17v3M18 17v3M6 10v4M10 10v4M14 10v4M18 10v4"/>',
    net: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
    battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2"/>',
    disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h4"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    shot: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    down: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    power: '<path d="M12 3v9"/><path d="M6.5 6.5a8 8 0 1 0 11 0"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    chevron: '<path d="M6 15l6-6 6 6"/>',
    toggles: '<rect x="2" y="5" width="20" height="6" rx="3"/><circle cx="17" cy="8" r="1.5"/><rect x="2" y="13" width="20" height="6" rx="3"/><circle cx="7" cy="16" r="1.5"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    task: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  };
  const ico = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

  // Quick toggles (bar pills and the Quick Toggles panel)
  const TOGGLES = {
    wifi: { name: "Wi-Fi", icon: "wifi", key: "wifi" },
    bluetooth: { name: "Bluetooth", icon: "bluetooth", key: "bluetooth" },
    dark: { name: "Dark mode", icon: "moon", key: "dark" },
    keepawake: { name: "Keep awake", icon: "coffee", key: "keep_awake" },
    mute: { name: "Mute", icon: "mute", key: "muted" },
    mic: { name: "Mic off", icon: "micoff", key: "mic_muted" },
    desktop: { name: "Desktop icons", icon: "desktop", key: "desktop_icons" },
    taskbar: { name: "Hide taskbar", icon: "taskbar", key: "taskbar_hidden" },
    nightlight: { name: "Night light", icon: "sun", opens: true },
    focus: { name: "Focus", icon: "focus", opens: true },
    airplane: { name: "Airplane", icon: "plane", opens: true },
    energy: { name: "Energy saver", icon: "leaf", opens: true },
  };

  const tempUnit = (s) => (s.units === "metric" ? "°C" : "°F");
  const pill = (inner, cls = "", title = "") => `<div class="pill ${cls}" title="${esc(title)}">${inner}</div>`;

  const W = [
    // ---- core
    { id: "search", cat: "Core", name: "Search", desc: "Apps, files, maths, conversions, commands", popup: ["search", 640, 460],
      html: () => `<div class="search">${ico("search")}<span>Search or tell the dock…</span></div>` },
    { id: "toggles", cat: "Core", name: "Quick toggle pills", desc: "Your chosen switches, plus the full panel", events: ["toggles"],
      html: (c) => `<div class="pills">${(c.s.toggles || []).map((t) => {
        const d = TOGGLES[t]; if (!d) return "";
        const on = d.key && c.toggles && c.toggles[d.key];
        return `<button class="tpill ${on ? "on" : ""}" data-toggle="${t}" title="${esc(d.name)}">${ico(d.icon)}</button>`;
      }).join("")}<button class="tpill more" data-popup="toggles" title="Quick toggles">${ico("toggles")}</button></div>` },
    { id: "clock", cat: "Core", name: "Clock & calendar", desc: "Time and date; click for month view and agenda", tick: true, popup: ["calendar", 340, 470],
      html: (c) => `<div class="clock"><span class="time">${timeStr(c.now, c.s, c.s.clock_seconds ? { second: "2-digit" } : {})}</span><span class="date">${c.now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span></div>` },
    // ---- media & sound
    { id: "media", cat: "Media & sound", name: "Now playing", desc: "Song, artist and controls for any media app", events: ["media"], popup: ["media", 320, 380],
      html: (c) => {
        const m = c.media;
        if (!m || !m.has) return pill(`${ico("music")}<span class="dim">Nothing playing</span>`, "media");
        const art = m.thumb ? `<img class="art" src="${m.thumb}" alt="">` : `<span class="art ph">${ico("music")}</span>`;
        return pill(`${art}<span class="mtxt"><b>${esc(m.title || m.app)}</b><small>${esc(m.artist || m.app)}</small></span>` +
          `<button class="mbtn" data-media="toggle" title="${m.playing ? "Pause" : "Play"}">${ico(m.playing ? "pause" : "play")}</button>`, "media", `${m.title} — ${m.artist}`);
      } },
    { id: "volume", cat: "Media & sound", name: "Volume", desc: "Speaker level; scroll to change, click for slider", events: ["audio"], popup: ["volume", 320, 230], wheel: "volume",
      html: (c) => { const a = c.audio || {}; return pill(`${ico(a.muted || !a.volume ? "mute" : "speaker")}<span>${a.muted ? "Muted" : (a.volume ?? "–") + "%"}</span>`, "", a.device || "Speakers"); } },
    { id: "mic", cat: "Media & sound", name: "Microphone mute", desc: "One-click mic mute", events: ["toggles"],
      html: (c) => `<button class="tpill ${c.toggles && c.toggles.mic_muted ? "on warn" : ""}" data-toggle="mic" title="Microphone">${ico(c.toggles && c.toggles.mic_muted ? "micoff" : "mic")}</button>` },
    // ---- info
    { id: "weather", cat: "Info", name: "Weather", desc: "Current conditions; click for hourly and 7-day", events: ["weather"], popup: ["weather", 360, 470],
      html: (c) => {
        const w = c.weather;
        if (!c.s.weather_city) return pill(`<span>🌡️</span><span class="dim">Set city</span>`, "", "Set your city in Settings");
        if (!w || !w.current) return pill(`<span>🌡️</span><span class="dim">…</span>`);
        const [txt, em] = wmo(w.current.weather_code);
        return pill(`<span class="em">${em}</span><span>${Math.round(w.current.temperature_2m)}${tempUnit(c.s)}</span>`, "", `${txt} · ${c.s.weather_city}`);
      } },
    { id: "nextevent", cat: "Info", name: "Next event", desc: "Your next calendar event (needs a calendar link)", events: ["calendar"], tick: true, popup: ["calendar", 340, 470],
      html: (c) => {
        const e = c.nextEvent;
        if (!e) return pill(`${ico("cal")}<span class="dim">${(c.s.calendars || []).length ? "No events" : "Add calendar"}</span>`);
        const mins = Math.round((e.start - c.now) / 60000);
        const when = mins <= 0 ? "now" : mins < 60 ? `in ${mins} min` : timeStr(e.start, c.s);
        return pill(`${ico("cal")}<span class="mtxt"><b>${esc(e.title || "Event")}</b><small>${when}</small></span>`, "", e.title);
      } },
    { id: "worldclock", cat: "Info", name: "World clock", desc: "A second time zone", tick: true,
      html: (c) => { let t = "–"; try { t = c.now.toLocaleTimeString([], { timeZone: c.s.world_tz, hour: "numeric", minute: "2-digit", hour12: !c.s.clock_24h }); } catch {} const city = (c.s.world_tz || "").split("/").pop().replace(/_/g, " "); return pill(`${ico("globe")}<span class="mtxt"><b>${t}</b><small>${esc(city)}</small></span>`); } },
    { id: "currency", cat: "Info", name: "Exchange rate", desc: "Live rate for a currency pair; click to convert", events: ["currency"], popup: ["currency", 320, 260],
      html: (c) => pill(`${ico("cash")}<span>${esc(c.s.currency_from)}→${esc(c.s.currency_to)} ${c.rate ? c.rate.toFixed(4) : "…"}</span>`) },
    { id: "date", cat: "Info", name: "Date", desc: "Big day and date", tick: true, popup: ["calendar", 340, 470],
      html: (c) => `<div class="datebig"><b>${c.now.getDate()}</b><span>${c.now.toLocaleDateString([], { weekday: "short" })}<br>${c.now.toLocaleDateString([], { month: "short" })}</span></div>` },
    // ---- system
    { id: "cpu", cat: "System", name: "CPU", desc: "Processor use", stats: true, events: ["stats"], popup: ["system", 340, 360],
      html: (c) => pill(`${ico("cpu")}<span>${c.stats ? Math.round(c.stats.cpu) + "%" : "–"}</span>`, "", "CPU") },
    { id: "ram", cat: "System", name: "Memory", desc: "RAM in use", stats: true, events: ["stats"], popup: ["system", 340, 360],
      html: (c) => pill(`${ico("ram")}<span>${c.stats ? Math.round(c.stats.ram_pct) + "%" : "–"}</span>`, "", c.stats ? `${c.stats.ram_used_gb.toFixed(1)} of ${c.stats.ram_total_gb.toFixed(1)} GB` : "Memory") },
    { id: "network", cat: "System", name: "Network speed", desc: "Download and upload right now", stats: true, events: ["stats"], popup: ["system", 340, 360],
      html: (c) => pill(`${ico("net")}<span class="mtxt"><small>↓ ${c.stats ? fmtRate(c.stats.net_down) : "–"}</small><small>↑ ${c.stats ? fmtRate(c.stats.net_up) : "–"}</small></span>`) },
    { id: "battery", cat: "System", name: "Battery", desc: "Charge level (laptops)", stats: true, events: ["stats"],
      html: (c) => { const b = c.stats && c.stats.battery; return b == null ? pill(`${ico("battery")}<span class="dim">AC</span>`, "", "No battery") : pill(`${ico("battery")}<span>${b}%${c.stats.charging ? " ⚡" : ""}</span>`, b < 20 && !c.stats.charging ? "warn" : ""); } },
    { id: "disk", cat: "System", name: "Disk space", desc: "Free space on the system drive", stats: true, events: ["stats"],
      html: (c) => pill(`${ico("disk")}<span>${c.stats ? Math.round(c.stats.disk_free_gb) + " GB free" : "–"}</span>`) },
    { id: "uptime", cat: "System", name: "Uptime", desc: "Time since start-up", stats: true, events: ["stats"],
      html: (c) => pill(`${ico("pulse")}<span>${c.stats ? fmtUp(c.stats.uptime_s) : "–"}</span>`, "", "Uptime") },
    // ---- tools
    { id: "notes", cat: "Tools", name: "Quick note", desc: "A scratch pad that saves itself", popup: ["notes", 360, 380], html: () => `<button class="tpill" title="Quick note">${ico("note")}</button>` },
    { id: "timer", cat: "Tools", name: "Timer", desc: "Countdown, stopwatch and focus timer", events: ["timer"], tick: true, popup: ["timer", 320, 330],
      html: (c) => { const t = c.timer || {}; if (!t.running && !t.paused) return `<button class="tpill" title="Timer">${ico("timer")}</button>`; return pill(`${ico("timer")}<span class="mono">${timerText(t, c.now)}</span>`, t.paused ? "dim" : "accent"); } },
    { id: "screenshot", cat: "Tools", name: "Screenshot", desc: "Snip part of the screen", action: "screenshot", html: () => `<button class="tpill" title="Screenshot">${ico("shot")}</button>` },
    { id: "showdesktop", cat: "Tools", name: "Show desktop", desc: "Minimise everything", action: "desktop", html: () => `<button class="tpill" title="Show desktop">${ico("desktop")}</button>` },
    { id: "recycle", cat: "Tools", name: "Recycle Bin", desc: "See and empty the bin", popup: ["recycle", 300, 200], html: () => `<button class="tpill" title="Recycle Bin">${ico("trash")}</button>` },
    { id: "downloads", cat: "Tools", name: "Downloads", desc: "Open your Downloads folder", action: "downloads", html: () => `<button class="tpill" title="Downloads">${ico("down")}</button>` },
    { id: "allapps", cat: "Tools", name: "All apps", desc: "Every installed app in a grid", popup: ["allapps", 520, 520], html: () => `<button class="tpill" title="All apps">${ico("grid")}</button>` },
    { id: "taskmgr", cat: "Tools", name: "Task Manager", desc: "Open Task Manager", action: "taskmgr", html: () => `<button class="tpill" title="Task Manager">${ico("task")}</button>` },
    { id: "keepawake", cat: "Tools", name: "Keep awake", desc: "Stop the PC and screen from sleeping", events: ["toggles"],
      html: (c) => `<button class="tpill ${c.toggles && c.toggles.keep_awake ? "on" : ""}" data-toggle="keepawake" title="Keep awake">${ico("coffee")}</button>` },
    { id: "lock", cat: "Tools", name: "Lock", desc: "Lock the PC", action: "lock", html: () => `<button class="tpill" title="Lock">${ico("lock")}</button>` },
    { id: "power", cat: "Tools", name: "Power", desc: "Sleep, restart, shut down", popup: ["power", 260, 300], html: () => `<button class="tpill" title="Power">${ico("power")}</button>` },
    { id: "settings", cat: "Tools", name: "Dock settings", desc: "Open Glide Dock settings", action: "@settings", html: () => `<button class="tpill" title="Dock settings">${ico("gear")}</button>` },
    // ---- layout
    { id: "divider", cat: "Layout", name: "Divider", desc: "A thin line", multi: true, html: () => `<span class="divider"></span>` },
    { id: "spacer", cat: "Layout", name: "Spacer", desc: "Empty space", multi: true, html: () => `<span class="spacer"></span>` },
  ];

  function fmtUp(s) { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : `${h}h ${m}m`; }
  function timerText(t, now) {
    if (t.mode === "stopwatch") return fmtDur(((t.paused ? t.pausedAt : +now) - t.start) / 1000);
    return fmtDur(((t.paused ? t.remain : t.end - +now)) / 1000);
  }

  window.GDW = { list: W, byId: Object.fromEntries(W.map((w) => [w.id, w])), TOGGLES, ico, timerText };
})();
