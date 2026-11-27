// The bar. Draws widgets and apps from events Rust sends; does no polling of its own except the clock tick
// (one timer, aligned to the next second or minute, stopped while hidden or under a full-screen app).
(() => {
  const { invoke, listen, esc, icon, cachedJson, calendarEvents, weather } = window.GD;
  const { byId } = window.GDW;
  const $ = (id) => document.getElementById(id);

  const ctx = { s: null, now: new Date(), media: null, audio: null, stats: null, toggles: null, weather: null, timer: null, nextEvent: null, rate: null, apps: [] };
  let paused = false, tickTimer = 0, slowTimer = 0;

  // ------------------------------------------------------------------ settings & theme
  function applyTheme(s) {
    const root = document.documentElement;
    const light = s.theme === "light" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    root.classList.toggle("light", light);
    root.style.setProperty("--r", s.corner_radius + "px");
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--bg", `rgba(${light ? "246, 246, 250" : "18, 18, 24"}, ${s.opacity})`);
    $("bar").style.setProperty("--isz", s.icon_size + "px");
  }

  function onSettings(s) {
    const first = !ctx.s;
    const old = ctx.s || {};
    ctx.s = s;
    applyTheme(s);
    renderZones();
    renderApps();
    const wants = [...s.left, ...s.right].some((id) => byId[id] && byId[id].stats);
    invoke("stats_enable", { on: wants }).catch(() => {});
    if (first || old.weather_lat !== s.weather_lat || old.units !== s.units) refreshWeather();
    if (first || String(old.calendars) !== String(s.calendars)) refreshCalendar();
    if (first || old.currency_from !== s.currency_from || old.currency_to !== s.currency_to) refreshRate();
    tick();
  }

  // ------------------------------------------------------------------ widgets
  const layout = () => [...(ctx.s.left || []).map((id, i) => ["left", id, i]), ...(ctx.s.right || []).map((id, i) => ["right", id, i])];

  function renderZones() {
    for (const side of ["left", "right"]) {
      const zone = $(side);
      zone.innerHTML = "";
      (ctx.s[side] || []).forEach((id, i) => {
        const w = byId[id]; if (!w) return;
        const el = document.createElement("div");
        el.className = "w" + (w.popup || w.action ? " click" : "");
        el.dataset.id = id; el.dataset.key = side + i;
        zone.appendChild(el);
        drawWidget(el);
      });
    }
  }
  function drawWidget(el) {
    const w = byId[el.dataset.id];
    try { el.innerHTML = w.html(ctx); } catch (e) { el.innerHTML = ""; console.error(w.id, e); }
  }
  function redraw(event) {
    document.querySelectorAll(".zone .w").forEach((el) => {
      const w = byId[el.dataset.id];
      if (!event || (w.events || []).includes(event) || (event === "tick" && w.tick)) drawWidget(el);
    });
  }

  function anchorOf(el) { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }
  function openPopup(route, w, h, el) { invoke("show_popup", { route, anchor: anchorOf(el), width: w, height: h }).catch(() => {}); }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle],[data-media],[data-popup],.w,.app");
    if (!t) return;
    if (t.dataset.toggle) { e.stopPropagation(); quickToggle(t.dataset.toggle); return; }
    if (t.dataset.media) { e.stopPropagation(); invoke("media_cmd", { action: t.dataset.media }); return; }
    if (t.dataset.popup) { const W = { toggles: [380, 430] }[t.dataset.popup] || [340, 400]; openPopup(t.dataset.popup, W[0], W[1], t); return; }
    if (t.classList.contains("w")) {
      const w = byId[t.dataset.id];
      if (w.popup) openPopup(w.popup[0], w.popup[1], w.popup[2], t);
      else if (w.action === "@settings") invoke("open_settings", {});
      else if (w.action) invoke("system_action", { action: w.action });
    }
  });

  document.addEventListener("wheel", (e) => {
    const t = e.target.closest(".w");
    if (!t || byId[t.dataset.id].wheel !== "volume" || !ctx.audio) return;
    const v = Math.max(0, Math.min(100, ctx.audio.volume + (e.deltaY < 0 ? 2 : -2)));
    ctx.audio = { ...ctx.audio, volume: v, muted: false };
    redraw("audio");
    invoke("set_volume", { volume: v });
  }, { passive: true });

  async function quickToggle(id) {
    const d = window.GDW.TOGGLES[id];
    if (!d) return;
    if (d.opens) { invoke("toggle", { id, on: true }); return; }
    const cur = !!(ctx.toggles && ctx.toggles[d.key]);
    ctx.toggles = { ...(ctx.toggles || {}), [d.key]: !cur };
    redraw("toggles");
    const ok = await invoke("toggle", { id, on: !cur }).catch(() => false);
    if (!ok) refreshToggles();
  }
  async function refreshToggles() {
    ctx.toggles = await invoke("toggles_state").catch(() => ctx.toggles);
    redraw("toggles");
  }

  // ------------------------------------------------------------------ apps (pinned + running)
  const lc = (s) => (s || "").toLowerCase();
  // A running app belongs to a pin if it has the same app ID or program. Apps that update themselves into a new
  // folder each version (Discord, Slack, Teams...) are matched on the program's file name too.
  const base = (p) => lc(p).split("\\").pop();
  const GENERIC = new Set(["update.exe", "applicationframehost.exe", "javaw.exe", "java.exe", "python.exe", "pythonw.exe", "electron.exe", "msedgewebview2.exe", "cmd.exe", "powershell.exe"]);
  function sameApp(a, p) {
    if (lc(a.target) === lc(p.launch)) return true;
    if (!p.exe) return false;
    if (lc(a.target) === lc(p.exe) || lc(a.exe) === lc(p.exe)) return true;
    const b = base(p.exe);
    return b.endsWith(".exe") && !GENERIC.has(b) && b === base(a.exe);
  }
  function items() {
    const pins = ctx.s.pinned || [];
    const used = new Set();
    const out = pins.map((p) => {
      const r = ctx.apps.find((a) => !used.has(a) && sameApp(a, p));
      if (r) used.add(r);
      return { pin: p, run: r || null, pinned: true };
    });
    for (const a of ctx.apps) if (!used.has(a)) out.push({ pin: { name: a.name, launch: a.target, exe: a.exe || "" }, run: a, pinned: false });
    return out;
  }

  function renderApps() {
    const box = $("apps");
    const list = items();
    const keys = list.map((x) => x.pin.launch);
    // reuse existing elements so icons don't flicker
    const existing = new Map([...box.children].map((el) => [el.dataset.launch, el]));
    box.textContent = "";
    list.forEach((it, i) => {
      let el = existing.get(it.pin.launch);
      if (!el) {
        el = document.createElement("div");
        el.className = "app";
        el.dataset.launch = it.pin.launch;
        el.innerHTML = `<span class="ph"></span><span class="dot"></span>`;
        icon(it.pin.exe || it.pin.launch, 64).then((src) => { if (src) el.querySelector(".ph, img").outerHTML = `<img src="${src}" alt="">`; });
      }
      el.dataset.i = i;
      el.draggable = it.pinned;
      const n = it.run ? it.run.windows.length : 0;
      el.title = it.run && n === 1 ? it.run.windows[0].title : it.pin.name + (n > 1 ? ` — ${n} windows` : "");
      el.classList.toggle("running", n > 0);
      el.classList.toggle("multi", n > 1);
      el.classList.toggle("active", !!(it.run && it.run.active));
      el.querySelector(".dot").style.display = n ? "" : "none";
      el._it = it;
      box.appendChild(el);
    });
    void keys;
  }

  $("apps").addEventListener("click", (e) => {
    const el = e.target.closest(".app"); if (!el) return;
    const it = el._it;
    if (e.shiftKey || !it.run) invoke("app_launch", { target: it.pin.launch });
    else invoke("app_click", { target: it.run.target });
  });
  $("apps").addEventListener("auxclick", (e) => {
    const el = e.target.closest(".app");
    if (el && e.button === 1) invoke("app_launch", { target: el._it.pin.launch });
  });
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest(".app");
    if (el) invoke("app_menu", { pin: el._it.pin });
    else if (!e.target.closest(".w")) invoke("bar_menu");
  });

  // drag to reorder pinned apps
  let dragFrom = null;
  $("apps").addEventListener("dragstart", (e) => { const el = e.target.closest(".app"); if (!el) return; dragFrom = +el.dataset.i; el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; });
  $("apps").addEventListener("dragend", () => { dragFrom = null; document.querySelectorAll(".app").forEach((x) => x.classList.remove("drag", "over")); });
  $("apps").addEventListener("dragover", (e) => { const el = e.target.closest(".app"); if (dragFrom == null || !el || !el._it.pinned) return; e.preventDefault(); document.querySelectorAll(".app.over").forEach((x) => x.classList.remove("over")); el.classList.add("over"); });
  $("apps").addEventListener("drop", (e) => {
    const el = e.target.closest(".app"); if (dragFrom == null || !el) return;
    e.preventDefault();
    const to = +el.dataset.i;
    const pins = [...ctx.s.pinned]; const [m] = pins.splice(dragFrom, 1); pins.splice(Math.min(to, pins.length), 0, m);
    invoke("save_settings", { settings: { ...ctx.s, pinned: pins } });
  });

  // magnification: icons near the pointer grow (within the bar's height), neighbours make room
  let magRaf = 0, magX = null;
  function magnify() {
    magRaf = 0;
    const s = ctx.s, apps = [...document.querySelectorAll(".app")];
    const base = s.icon_size, max = Math.max(base, Math.min(base * 1.5, $("bar").clientHeight - 14));
    apps.forEach((el) => {
      if (magX == null || !s.magnify) { el.style.width = ""; el.classList.remove("mag"); return; }
      const r = el.getBoundingClientRect();
      const d = (r.left + r.width / 2 - magX) / (base * 1.6);
      el.classList.add("mag");
      el.style.width = (base + (max - base) * Math.exp(-d * d)).toFixed(1) + "px";
    });
  }
  $("apps").addEventListener("mousemove", (e) => { magX = e.clientX; if (!magRaf) magRaf = requestAnimationFrame(magnify); });
  $("apps").addEventListener("mouseleave", () => { magX = null; if (!magRaf) magRaf = requestAnimationFrame(magnify); });

  // ------------------------------------------------------------------ data refresh (weather, calendar, rate)
  async function refreshWeather() {
    if (!ctx.s.weather_city || (!ctx.s.weather_lat && !ctx.s.weather_lon)) { ctx.weather = null; redraw("weather"); return; }
    try { ctx.weather = await weather(ctx.s.weather_lat, ctx.s.weather_lon, ctx.s.units); } catch { /* keep last */ }
    redraw("weather");
  }
  let events = [];
  async function refreshCalendar() {
    if (!(ctx.s.calendars || []).length) { events = []; ctx.nextEvent = null; redraw("calendar"); return; }
    const from = new Date(); from.setHours(0, 0, 0, 0);
    try { events = await calendarEvents(ctx.s, from, new Date(+from + 8 * 864e5)); } catch {}
    pickNext();
  }
  function pickNext() {
    const now = Date.now();
    ctx.nextEvent = events.find((e) => !e.allDay && +e.end > now) || null;
    redraw("calendar");
  }
  async function refreshRate() {
    const used = [...ctx.s.left, ...ctx.s.right].includes("currency");
    if (!used) return;
    try {
      const j = await cachedJson(`https://api.frankfurter.dev/v1/latest?base=${ctx.s.currency_from}&symbols=${ctx.s.currency_to}`, 3 * 36e5);
      ctx.rate = j.rates && j.rates[ctx.s.currency_to];
    } catch {}
    redraw("currency");
  }
  function slowRefresh() {
    clearInterval(slowTimer);
    slowTimer = setInterval(() => { if (!paused) { refreshWeather(); refreshCalendar(); refreshRate(); } }, 30 * 60e3);
  }

  // ------------------------------------------------------------------ the one ticker
  function tick() {
    clearTimeout(tickTimer);
    if (paused || !ctx.s) return;
    ctx.now = new Date();
    redraw("tick");
    if (ctx.nextEvent && +ctx.nextEvent.end < +ctx.now) pickNext();
    const t = ctx.timer || {};
    if (t.running && t.mode !== "stopwatch" && t.end && +ctx.now >= t.end) timerDone();
    const ids = layout().map((x) => x[1]);
    const perSecond = (ids.includes("clock") && ctx.s.clock_seconds) || (ids.includes("timer") && t.running);
    const ms = ctx.now.getMilliseconds(), sec = ctx.now.getSeconds();
    tickTimer = setTimeout(tick, (perSecond ? 1000 - ms : 60000 - sec * 1000 - ms) + 5);
  }
  function timerDone() {
    const t = ctx.timer;
    const next = { running: false, done: true, mode: t.mode, label: t.label };
    invoke("timer_set", { value: next });
    try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=").play(); } catch {}
    invoke("show_popup", { route: "timer", anchor: document.body.clientWidth - 160, width: 320, height: 330 });
  }
  function setPaused(p) {
    paused = p;
    if (!p) { tick(); refreshToggles(); } else clearTimeout(tickTimer);
  }
  document.addEventListener("visibilitychange", () => setPaused(document.hidden));

  // ------------------------------------------------------------------ wire up
  listen("settings", onSettings);
  listen("apps", (a) => { ctx.apps = a; if (ctx.s) renderApps(); });
  listen("audio", (a) => { ctx.audio = a; if (ctx.toggles) { ctx.toggles.muted = a.muted; ctx.toggles.mic_muted = a.mic_muted; } redraw("audio"); redraw("toggles"); });
  listen("media", (m) => { ctx.media = m; redraw("media"); });
  listen("stats", (s) => { ctx.stats = s; redraw("stats"); });
  listen("timer", (t) => { ctx.timer = t; redraw("timer"); tick(); });
  listen("toggles-changed", refreshToggles);
  listen("fullscreen", (f) => setPaused(!!f));
  listen("weather-changed", refreshWeather);

  (async () => {
    const s = await invoke("get_settings");
    const [apps, audio, media, timer] = await Promise.all([
      invoke("apps_list").catch(() => []), invoke("audio_state").catch(() => null),
      invoke("media_state").catch(() => null), invoke("timer_get").catch(() => null),
    ]);
    Object.assign(ctx, { apps, audio, media, timer });
    onSettings(s);
    refreshToggles();
    slowRefresh();
  })().catch((e) => console.error(e));
})();
