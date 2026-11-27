// The popup above the bar. One window, many views ("routes"); Rust tells it which one to show.
(() => {
  const G = window.GD, { invoke, listen, esc, icon } = G;
  const { ico, TOGGLES, byId, list: WIDGETS, timerText } = window.GDW;
  const panel = document.getElementById("panel");
  let S = null, route = "", cleanup = [];
  const VIEWS = {};
  const hide = () => invoke("hide_popup");

  function applyTheme(s) {
    const light = s.theme === "light" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.classList.toggle("light", light);
    document.documentElement.style.setProperty("--accent", s.accent);
  }
  async function saveSettings(patch) { S = await invoke("save_settings", { settings: { ...S, ...patch } }); return S; }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input,textarea")) e.preventDefault(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cleanup.forEach((f) => f()); cleanup = []; } });

  async function show(r) {
    cleanup.forEach((f) => f()); cleanup = [];
    route = r;
    S = await invoke("get_settings");
    applyTheme(S);
    panel.innerHTML = "";
    (VIEWS[r] || VIEWS.search)();
  }

  // ================================================================== search
  function commands(q) {
    const s = q.trim().toLowerCase(); const out = [];
    const add = (title, sub, run, icon = "gear") => out.push({ kind: "cmd", title, sub, run, icon });
    let m;
    const onoff = (w) => (/\b(off|disable|stop)\b/.test(w) ? false : /\b(on|enable|start)\b/.test(w) ? true : null);
    if ((m = s.match(/^(dark|light) ?mode ?(on|off)?$/))) { const on = m[1] === "dark" ? m[2] !== "off" : m[2] === "off"; add(`Turn dark mode ${on ? "on" : "off"}`, "Windows apps theme", () => invoke("toggle", { id: "dark", on }), "moon"); }
    if ((m = s.match(/^(wi-?fi|bluetooth) ?(on|off)$/))) { const id = m[1].startsWith("w") ? "wifi" : "bluetooth"; add(`Turn ${id === "wifi" ? "Wi-Fi" : "Bluetooth"} ${m[2]}`, "", () => invoke("toggle", { id, on: m[2] === "on" }), id); }
    if (/^(mute|unmute)$/.test(s)) add(s === "mute" ? "Mute speakers" : "Unmute speakers", "", () => invoke("set_mute", { muted: s === "mute" }), "mute");
    if ((m = s.match(/^(?:volume|vol) (\d{1,3})%?$/))) add(`Set volume to ${Math.min(100, +m[1])}%`, "", () => invoke("set_volume", { volume: Math.min(100, +m[1]) }), "speaker");
    if ((m = s.match(/^(?:keep awake|caffeine|stay awake) ?(on|off)?$/))) add(`Keep awake ${m[1] || "on"}`, "Stops sleep until turned off", () => invoke("toggle", { id: "keepawake", on: m[1] !== "off" }), "coffee");
    if ((m = s.match(/^(hide|show) (?:the )?(?:windows )?taskbar$/))) add(`${m[1] === "hide" ? "Hide" : "Show"} the Windows taskbar`, "", () => invoke("toggle", { id: "taskbar", on: m[1] === "hide" }), "taskbar");
    if ((m = s.match(/^(?:dock )?height (\d{2,3})$/))) add(`Dock height ${m[1]} px`, "", () => saveSettings({ dock_height: +m[1] }));
    if ((m = s.match(/^(bigger|larger|smaller) dock$/))) { const d = m[1] === "smaller" ? -8 : 8; add(`Make the dock ${m[1]}`, `${S.dock_height} → ${S.dock_height + d} px`, () => saveSettings({ dock_height: S.dock_height + d, icon_size: S.icon_size + d / 2 })); }
    if ((m = s.match(/^icon size (\d{2})$/))) add(`Icon size ${m[1]} px`, "", () => saveSettings({ icon_size: +m[1] }));
    if ((m = s.match(/^(?:dock )?opacity (\d{1,3})%?$/))) add(`Dock opacity ${m[1]}%`, "", () => saveSettings({ opacity: +m[1] / 100 }));
    if ((m = s.match(/^(?:dock )?(dark|light|auto) theme$/))) add(`Dock theme: ${m[1]}`, "", () => saveSettings({ theme: m[1] }));
    const COLORS = { red: "#ff4d6d", pink: "#ff5fa2", orange: "#ff8a3d", yellow: "#f5c518", green: "#2ecc71", teal: "#1abc9c", blue: "#3d8bff", purple: "#9b59ff", white: "#e8e8ee" };
    if ((m = s.match(/^accent (#[0-9a-f]{6}|\w+)$/)) && (m[1].startsWith("#") || COLORS[m[1]])) add(`Accent colour ${m[1]}`, "", () => saveSettings({ accent: m[1].startsWith("#") ? m[1] : COLORS[m[1]] }));
    if ((m = s.match(/^(add|remove) (?:the )?(.+?) widget$/))) {
      const w = WIDGETS.find((x) => x.id === m[2].replace(/\s/g, "") || x.name.toLowerCase().includes(m[2]));
      if (w) add(`${m[1] === "add" ? "Add" : "Remove"} the ${w.name} widget`, w.desc, () => m[1] === "add"
        ? saveSettings({ right: [w.id, ...S.right.filter((x) => x !== w.id || w.multi)] })
        : saveSettings({ left: S.left.filter((x) => x !== w.id), right: S.right.filter((x) => x !== w.id) }), "grid");
    }
    if ((m = s.match(/^(?:timer|countdown) (\d+) ?(s|sec|m|min|h|hr)?/))) { const mult = { s: 1, sec: 1, h: 3600, hr: 3600 }[m[2]] || 60; add(`Start a ${m[1]}${m[2] || " min"} timer`, "", () => startTimer({ mode: "countdown", ms: +m[1] * mult * 1000 }), "timer"); }
    if (s === "stopwatch") add("Start the stopwatch", "", () => startTimer({ mode: "stopwatch" }), "timer");
    if ((m = q.trim().match(/^note[: ]+(.+)$/i))) add("Add to quick note", m[1], async () => { const t = await invoke("notes_get"); await invoke("notes_set", { text: (t ? t.replace(/\s*$/, "\n") : "") + "- " + m[1] + "\n" }); }, "note");
    if ((m = q.trim().match(/^(?:set )?city (.+)$/i))) add(`Set weather city to ${m[1]}`, "", () => setCity(m[1]), "globe");
    const ACT = { lock: ["Lock the PC", "lock", "lock"], sleep: ["Sleep", "sleep", "power"], restart: ["Restart", "restart", "power"], "shut down": ["Shut down", "shutdown", "power"], shutdown: ["Shut down", "shutdown", "power"], "sign out": ["Sign out", "signout", "power"], screenshot: ["Take a screenshot", "screenshot", "shot"], "show desktop": ["Show desktop", "desktop", "desktop"], "empty recycle bin": ["Empty the Recycle Bin", "recycle-empty", "trash"], "task manager": ["Open Task Manager", "taskmgr", "task"], downloads: ["Open Downloads", "downloads", "down"] };
    for (const [k, [t, a, i]] of Object.entries(ACT)) if (k.startsWith(s) && s.length >= 3) add(t, ["restart", "shutdown", "signout"].includes(a) ? "Press Enter twice to confirm" : "", () => invoke("system_action", { action: a }), i);
    if ("settings".startsWith(s) && s.length >= 3 || /^(dock )?settings$/.test(s)) add("Open dock settings", "", () => invoke("open_settings", {}));
    if (/^(quit|exit) (the )?dock$/.test(s)) add("Quit Glide Dock", "The Windows taskbar comes back", () => invoke("quit"), "power");
    void onoff;
    return out;
  }
  async function setCity(name) {
    const g = await G.geocode(name);
    if (!g) throw new Error("City not found");
    await saveSettings({ weather_city: g.name, weather_lat: g.lat, weather_lon: g.lon });
  }

  VIEWS.search = () => {
    panel.innerHTML = `<label class="sbox">${ico("search")}<input id="q" type="text" placeholder="Search apps, files, maths, “5 km in miles”, “dark mode on”…" autocomplete="off" spellcheck="false"></label>
      <div class="sbody"><div class="results" id="res"></div><div class="preview" id="pv" hidden></div></div>`;
    const q = document.getElementById("q"), res = document.getElementById("res"), pv = document.getElementById("pv");
    let items = [], sel = 0, seq = 0, confirmKey = null, timer = 0;
    invoke("search_warm").catch(() => {});
    setTimeout(() => q.focus(), 30);

    function draw(answer, groups) {
      items = [];
      let h = "";
      if (answer) { items.push(answer); h += `<div class="answer res" data-i="0"><b>${esc(answer.title)}</b><span class="muted">${esc(answer.sub || "")} · Enter to copy</span></div>`; }
      for (const [name, list] of groups) {
        if (!list.length) continue;
        h += `<div class="group">${name}</div>`;
        for (const it of list) {
          const i = items.push(it) - 1;
          const left = it.kind === "app" || it.kind === "file" ? `<span class="ri" data-icon="${esc(it.iconTarget)}"></span>` : `<span class="ri">${ico(it.icon || "search")}</span>`;
          h += `<div class="res" data-i="${i}">${left}<div class="rt"><b>${esc(it.title)}</b><small>${esc(it.sub || "")}</small></div>${it.kind === "file" ? '<span class="kbd">Alt+Enter: folder</span>' : ""}</div>`;
        }
      }
      res.innerHTML = h || (q.value.trim() ? `<div class="empty">No matches.</div>` : `<div class="empty">Type to search apps and files, do maths (<b>12% of 340</b>), convert (<b>5 km in miles</b>, <b>100 usd to eur</b>), check a time (<b>time in tokyo</b>) or tell the dock what to do (<b>dark mode on</b>, <b>timer 10 min</b>, <b>add weather widget</b>).</div>`);
      res.querySelectorAll("[data-icon]").forEach((el) => icon(el.dataset.icon, 32).then((src) => { if (src) el.outerHTML = `<img src="${src}" alt="">`; }));
      sel = Math.min(sel, Math.max(0, items.length - 1));
      mark();
    }
    function mark() {
      res.querySelectorAll(".res").forEach((el) => el.classList.toggle("sel", +el.dataset.i === sel));
      const el = res.querySelector(`.res[data-i="${sel}"]`); if (el) el.scrollIntoView({ block: "nearest" });
      const it = items[sel];
      if (it && it.kind === "file") previewFile(it.path); else pv.hidden = true;
    }
    async function previewFile(path) {
      const f = await invoke("file_info", { path });
      if (items[sel] && items[sel].path !== path) return;
      pv.hidden = false;
      pv.innerHTML = `${f.preview ? `<img src="${f.preview}" alt="">` : ""}${f.text != null ? `<pre>${esc(f.text)}</pre>` : ""}
        <div class="name">${esc(path.split("\\").pop())}</div><div class="muted">${f.dir ? "Folder" : G.fmtBytes(f.size)} · ${f.modified ? new Date(f.modified * 1000).toLocaleString() : ""}</div>
        <div class="muted" style="word-break:break-all">${esc(path)}</div>`;
    }
    async function run(it, alt) {
      if (!it) return;
      if (it.kind === "answer") { try { await navigator.clipboard.writeText(String(it.copy ?? it.title)); } catch {} it.title = "Copied ✓"; draw(it, []); setTimeout(hide, 400); return; }
      if (it.confirm && confirmKey !== it.title) { confirmKey = it.title; it.sub = "Press Enter again to confirm"; update(true); return; }
      if (it.kind === "file") { invoke("open_path", { path: it.path, reveal: !!alt }); hide(); return; }
      if (it.kind === "app") { invoke("app_launch", { target: it.launch }); hide(); return; }
      if (it.kind === "web") { invoke("open_url", { url: it.url }); hide(); return; }
      try { await it.run(); hide(); } catch (e) { it.sub = String(e.message || e); update(true); }
    }
    async function update(keep) {
      const text = q.value, my = ++seq;
      if (!keep) { sel = 0; confirmKey = null; }
      if (!text.trim()) { draw(null, []); return; }
      let answer = null;
      const c = G.calc(text);
      if (c != null) answer = { kind: "answer", title: "= " + c.toLocaleString(undefined, { maximumFractionDigits: 10 }), copy: c, sub: text };
      const cv = !answer && G.convert(text); if (cv) answer = { kind: "answer", title: cv.text, copy: cv.value, sub: "Unit conversion" };
      const tz = !answer && G.timeIn(text); if (tz) answer = { kind: "answer", title: tz.text, sub: tz.sub };
      const cmds = commands(text).map((x) => ({ ...x, confirm: /restart|shut down|sign out|quit/i.test(x.title) }));
      const web = [{ kind: "web", title: `Search the web for “${text.trim()}”`, sub: "Opens your browser", icon: "globe", url: "https://www.google.com/search?q=" + encodeURIComponent(text.trim()) }];
      draw(answer, [["Commands", cmds], ["Web", web]]);
      const r = await invoke("search_query", { q: text }).catch(() => ({ apps: [], files: [] }));
      if (my !== seq) return;
      const apps = r.apps.map((a) => ({ kind: "app", title: a.name, sub: "App", launch: a.launch, iconTarget: a.exe || a.launch }));
      const files = r.files.map((f) => ({ kind: "file", title: f.name, sub: f.path, path: f.path, iconTarget: f.path }));
      if (!answer) { try { const cur = await G.currency(text); if (my !== seq) return; if (cur) answer = { kind: "answer", title: cur.text, sub: cur.sub }; } catch {} }
      draw(answer, [["Apps", apps], ["Commands", cmds], ["Files", files], ["Web", web]]);
    }
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => update(false), 70); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === "Enter") { run(items[sel], e.altKey); e.preventDefault(); }
    });
    res.addEventListener("mousemove", (e) => { const el = e.target.closest(".res"); if (el && +el.dataset.i !== sel) { sel = +el.dataset.i; mark(); } });
    res.addEventListener("click", (e) => { const el = e.target.closest(".res"); if (el) run(items[+el.dataset.i], e.altKey); });
    draw(null, []);
  };

  // ================================================================== calendar
  VIEWS.calendar = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let month = new Date(today.getFullYear(), today.getMonth(), 1), sel = new Date(today), evs = [];
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    async function load() {
      const from = new Date(month); from.setDate(1 - from.getDay());
      evs = S.calendars.length ? await G.calendarEvents(S, from, new Date(+from + 43 * 864e5)).catch(() => []) : [];
      draw();
    }
    function draw() {
      const start = new Date(month); start.setDate(1 - start.getDay());
      const has = new Set(evs.map((e) => key(e.start)));
      let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="dow">${d}</div>`).join("");
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const c = ["d", d.getMonth() !== month.getMonth() && "out", +d === +today && "today", +d === +sel && "sel", has.has(key(d)) && "has"].filter(Boolean).join(" ");
        cells += `<div class="${c}" data-t="${+d}">${d.getDate()}</div>`;
      }
      const dayEvs = evs.filter((e) => key(e.start) === key(sel) || (e.allDay && +e.start <= +sel && +e.end > +sel));
      const t = (e) => (e.allDay ? "All day" : G.timeStr(e.start, S));
      const agenda = !S.calendars.length
        ? `<div class="empty">Add a calendar link (Google, Outlook or iCloud “secret address in iCal format”) in <a href="#" id="cs">Settings → Weather & calendar</a> to see your events here.</div>`
        : dayEvs.length ? dayEvs.map((e) => `<div class="ev"><span class="t">${t(e)}</span><span class="bar"></span><div class="grow"><b>${esc(e.title || "(no title)")}</b>${e.location ? `<div class="muted">${esc(e.location)}</div>` : ""}</div></div>`).join("")
        : `<div class="empty">Nothing on ${sel.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}.</div>`;
      panel.innerHTML = `<div class="row spread"><button class="btn round" id="pm" aria-label="Previous month">‹</button><b>${month.toLocaleDateString([], { month: "long", year: "numeric" })}</b><button class="btn round" id="nm" aria-label="Next month">›</button></div>
        <div class="cal">${cells}</div><h2>${+sel === +today ? "Today" : sel.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h2><div class="scroll">${agenda}</div>`;
      panel.querySelector("#pm").onclick = () => { month.setMonth(month.getMonth() - 1); load(); };
      panel.querySelector("#nm").onclick = () => { month.setMonth(month.getMonth() + 1); load(); };
      panel.querySelector(".cal").onclick = (e) => { const d = e.target.closest(".d"); if (d) { sel = new Date(+d.dataset.t); if (sel.getMonth() !== month.getMonth()) { month = new Date(sel.getFullYear(), sel.getMonth(), 1); load(); } else draw(); } };
      const cs = panel.querySelector("#cs"); if (cs) cs.onclick = (e) => { e.preventDefault(); invoke("open_settings", { tab: "data" }); hide(); };
    }
    draw(); load();
  };

  // ================================================================== quick toggles + volume
  VIEWS.toggles = async () => {
    let st = await invoke("toggles_state").catch(() => ({}));
    let au = await invoke("audio_state").catch(() => ({}));
    function draw() {
      const tiles = Object.entries(TOGGLES).map(([id, d]) => {
        const v = d.key ? st[d.key] : null;
        const na = d.key && (v === null || v === undefined) && (id === "wifi" || id === "bluetooth");
        return `<button class="tile ${v ? "on" : ""} ${na ? "na" : ""}" data-id="${id}" ${na ? 'title="Not available on this PC"' : ""}><span class="ib">${ico(d.icon)}</span>${esc(d.name)}${d.opens ? "<small>opens Settings</small>" : ""}</button>`;
      }).join("");
      panel.innerHTML = `<h2>Quick toggles</h2><div class="tgrid">${tiles}</div>
        <div class="row"><button class="btn round" id="mu" aria-label="Mute">${ico(au.muted ? "mute" : "speaker")}</button><input id="vol" type="range" min="0" max="100" value="${au.volume || 0}" aria-label="Volume"><span class="mono" id="vv" style="width:38px;text-align:right">${au.volume ?? 0}%</span></div>
        <div class="muted">${esc(au.device || "")}</div>`;
      panel.querySelector(".tgrid").onclick = async (e) => {
        const b = e.target.closest(".tile"); if (!b || b.classList.contains("na")) return;
        const d = TOGGLES[b.dataset.id];
        if (d.opens) { invoke("toggle", { id: b.dataset.id, on: true }); hide(); return; }
        st[d.key] = !st[d.key]; draw();
        const ok = await invoke("toggle", { id: b.dataset.id, on: st[d.key] }).catch(() => false);
        if (!ok) { st = await invoke("toggles_state"); draw(); }
      };
      volumeWire();
    }
    function volumeWire() {
      const v = panel.querySelector("#vol"), vv = panel.querySelector("#vv");
      v.oninput = () => { vv.textContent = v.value + "%"; invoke("set_volume", { volume: +v.value }); };
      panel.querySelector("#mu").onclick = () => invoke("set_mute", { muted: !au.muted });
    }
    draw();
    const un = await listen("audio", (a) => { au = a; st.muted = a.muted; st.mic_muted = a.mic_muted; if (route === "toggles" && !panel.querySelector("#vol:active")) draw(); });
    cleanup.push(un);
  };

  VIEWS.volume = async () => {
    let au = await invoke("audio_state").catch(() => ({}));
    function draw() {
      panel.innerHTML = `<h2>Sound</h2><div class="muted">${esc(au.device || "Speakers")}</div>
        <div class="row"><button class="btn round" id="mu" aria-label="Mute">${ico(au.muted ? "mute" : "speaker")}</button><input id="vol" type="range" min="0" max="100" value="${au.volume || 0}" aria-label="Volume"><span class="mono" id="vv" style="width:38px;text-align:right">${au.volume ?? 0}%</span></div>
        <div class="row"><button class="btn" id="mic">${ico(au.mic_muted ? "micoff" : "mic")}${au.mic_muted ? "Microphone muted" : "Microphone on"}</button><button class="btn" id="snd">Sound settings</button></div>`;
      const v = panel.querySelector("#vol"), vv = panel.querySelector("#vv");
      v.oninput = () => { vv.textContent = v.value + "%"; invoke("set_volume", { volume: +v.value }); };
      panel.querySelector("#mu").onclick = () => invoke("set_mute", { muted: !au.muted });
      panel.querySelector("#mic").onclick = () => invoke("toggle", { id: "mic", on: !au.mic_muted });
      panel.querySelector("#snd").onclick = () => { invoke("system_action", { action: "sound" }); hide(); };
    }
    draw();
    cleanup.push(await listen("audio", (a) => { au = a; if (!panel.querySelector("#vol:active")) draw(); }));
  };

  // ================================================================== media
  VIEWS.media = async () => {
    let m = await invoke("media_state").catch(() => ({}));
    function draw() {
      if (!m.has) { panel.innerHTML = `<h2>Now playing</h2><div class="empty">Nothing is playing. Start music or a video in any app that shows in Windows' media controls (Spotify, browsers, Media Player…).</div>`; return; }
      panel.innerHTML = `${m.thumb ? `<img class="bigart" src="${m.thumb}" alt="">` : `<div class="bigart">${ico("music")}</div>`}
        <div><b style="font-size:15px">${esc(m.title || "Unknown")}</b><div class="muted">${esc(m.artist || "")}${m.artist && m.app ? " · " : ""}${esc(m.app || "")}</div></div>
        <div class="ctrls"><button class="btn round big" data-a="prev" aria-label="Previous">${ico("prev")}</button><button class="btn round big primary" data-a="toggle" aria-label="Play or pause">${ico(m.playing ? "pause" : "play")}</button><button class="btn round big" data-a="next" aria-label="Next">${ico("next")}</button></div>`;
      panel.querySelector(".ctrls").onclick = (e) => { const b = e.target.closest("[data-a]"); if (b) invoke("media_cmd", { action: b.dataset.a }); };
    }
    draw();
    cleanup.push(await listen("media", (x) => { m = x; draw(); }));
  };

  // ================================================================== weather
  VIEWS.weather = async () => {
    if (!S.weather_city) {
      panel.innerHTML = `<h2>Weather</h2><div class="muted">Which city? (Uses Open-Meteo, free, no account.)</div><div class="row"><input id="city" type="text" class="grow" placeholder="e.g. Hot Springs"><button class="btn primary" id="go">Set</button></div><div class="muted" id="msg"></div>`;
      const go = async () => { try { panel.querySelector("#msg").textContent = "Looking up…"; await setCity(panel.querySelector("#city").value); show("weather"); } catch (e) { panel.querySelector("#msg").textContent = e.message; } };
      panel.querySelector("#go").onclick = go; panel.querySelector("#city").onkeydown = (e) => e.key === "Enter" && go();
      setTimeout(() => panel.querySelector("#city").focus(), 30);
      return;
    }
    panel.innerHTML = `<div class="empty">Loading weather…</div>`;
    let w;
    try { w = await G.weather(S.weather_lat, S.weather_lon, S.units); } catch (e) { panel.innerHTML = `<div class="empty">Couldn't load the weather (${esc(e)}).</div>`; return; }
    const u = S.units === "metric" ? "°C" : "°F", c = w.current, [txt, em] = G.wmo(c.weather_code);
    const nowH = w.hourly.time.findIndex((t) => new Date(t) >= new Date(Date.now() - 36e5));
    const hours = w.hourly.time.slice(nowH, nowH + 24).map((t, i) => { const k = nowH + i; return `<div><div class="muted">${new Date(t).toLocaleTimeString([], { hour: "numeric" })}</div><div>${G.wmo(w.hourly.weather_code[k])[1]}</div><b>${Math.round(w.hourly.temperature_2m[k])}°</b>${w.hourly.precipitation_probability[k] >= 20 ? `<div class="muted">${w.hourly.precipitation_probability[k]}%</div>` : ""}</div>`; }).join("");
    const lo = Math.min(...w.daily.temperature_2m_min), hi = Math.max(...w.daily.temperature_2m_max);
    const days = w.daily.time.map((t, i) => { const a = (w.daily.temperature_2m_min[i] - lo) / (hi - lo || 1) * 100, b = (w.daily.temperature_2m_max[i] - lo) / (hi - lo || 1) * 100;
      return `<div class="row"><span style="width:44px">${i ? new Date(t + "T12:00").toLocaleDateString([], { weekday: "short" }) : "Today"}</span><span style="width:24px">${G.wmo(w.daily.weather_code[i])[1]}</span><span class="muted mono" style="width:34px;text-align:right">${Math.round(w.daily.temperature_2m_min[i])}°</span><span class="tbar"><i style="left:${a}%;right:${100 - b}%"></i></span><span class="mono" style="width:34px">${Math.round(w.daily.temperature_2m_max[i])}°</span></div>`; }).join("");
    panel.innerHTML = `<div class="row spread"><div class="wnow"><span class="em">${em}</span><div><b>${Math.round(c.temperature_2m)}${u}</b><div>${txt}</div></div></div>
      <div class="muted" style="text-align:right">${esc(S.weather_city)}<br>Feels ${Math.round(c.apparent_temperature)}° · ${c.relative_humidity_2m}% humidity<br>Wind ${Math.round(c.wind_speed_10m)} ${S.units === "metric" ? "km/h" : "mph"}</div></div>
      <div class="hours">${hours}</div><div class="scroll days">${days}</div><div class="muted">Weather data by Open-Meteo.com</div>`;
  };

  // ================================================================== notes
  VIEWS.notes = async () => {
    panel.innerHTML = `<div class="row spread"><h2>Quick note</h2><span class="muted" id="st"></span></div><textarea class="note" id="t" placeholder="Type anything. It saves by itself." spellcheck="true"></textarea>`;
    const t = panel.querySelector("#t"), st = panel.querySelector("#st");
    t.value = await invoke("notes_get"); setTimeout(() => { t.focus(); t.selectionStart = t.value.length; }, 30);
    let timer = 0;
    const save = () => invoke("notes_set", { text: t.value }).then(() => (st.textContent = "Saved")).catch((e) => (st.textContent = String(e)));
    t.addEventListener("input", () => { st.textContent = "…"; clearTimeout(timer); timer = setTimeout(save, 500); });
    cleanup.push(() => { clearTimeout(timer); save(); });
  };

  // ================================================================== timer
  async function startTimer({ mode, ms, label }) {
    const now = Date.now();
    const v = mode === "stopwatch" ? { running: true, mode, start: now } : { running: true, mode, end: now + ms, total: ms, label: label || "" };
    await invoke("timer_set", { value: v });
  }
  VIEWS.timer = async () => {
    let t = await invoke("timer_get"), mode = t.mode || "countdown", iv = 0;
    function draw() {
      const active = t.running || t.paused;
      const disp = active ? timerText(t, new Date()) : t.done ? "Done!" : mode === "stopwatch" ? "0:00" : "—";
      const presets = mode === "focus" ? [25, 50] : [1, 5, 10, 15, 30, 60];
      panel.innerHTML = `<div class="seg">${["countdown:Timer", "stopwatch:Stopwatch", "focus:Focus"].map((x) => { const [k, n] = x.split(":"); return `<button data-m="${k}" class="${mode === k ? "on" : ""}">${n}</button>`; }).join("")}</div>
        <div class="bigtime" id="disp">${disp}</div>
        ${active ? `<div class="row" style="justify-content:center"><button class="btn primary" id="pp">${t.paused ? "Resume" : "Pause"}</button><button class="btn" id="rs">Reset</button></div>`
          : mode === "stopwatch" ? `<div class="row" style="justify-content:center"><button class="btn primary" id="go">Start</button></div>`
          : `<div class="row" style="flex-wrap:wrap;justify-content:center">${presets.map((p) => `<button class="btn" data-p="${p}">${p} min</button>`).join("")}</div>
             <div class="row"><input id="mins" type="number" min="1" max="600" placeholder="Minutes" class="grow"><button class="btn primary" id="go">Start</button></div>`}`;
      panel.querySelector(".seg").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b && !active) { mode = b.dataset.m; draw(); } };
      panel.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => startTimer({ mode, ms: +b.dataset.p * 60000, label: mode === "focus" ? "Focus" : "" })));
      const go = panel.querySelector("#go"); if (go) go.onclick = () => { if (mode === "stopwatch") startTimer({ mode }); else { const m = +panel.querySelector("#mins").value; if (m > 0) startTimer({ mode, ms: m * 60000 }); } };
      const pp = panel.querySelector("#pp"); if (pp) pp.onclick = () => {
        const now = Date.now(); let v;
        if (t.mode === "stopwatch") v = t.paused ? { ...t, running: true, paused: false, start: t.start + (now - t.pausedAt) } : { ...t, running: false, paused: true, pausedAt: now };
        else v = t.paused ? { ...t, running: true, paused: false, end: now + t.remain } : { ...t, running: false, paused: true, remain: t.end - now };
        invoke("timer_set", { value: v });
      };
      const rs = panel.querySelector("#rs"); if (rs) rs.onclick = () => invoke("timer_set", { value: { running: false, mode } });
    }
    draw();
    iv = setInterval(() => { const d = panel.querySelector("#disp"); if (d && t.running) d.textContent = timerText(t, new Date()); }, 250);
    cleanup.push(() => clearInterval(iv));
    cleanup.push(await listen("timer", (x) => { t = x; if (x.mode) mode = x.mode; draw(); }));
  };

  // ================================================================== power, system, recycle, all apps, currency
  VIEWS.power = () => {
    const A = [["lock", "Lock", "lock"], ["sleep", "Sleep", "moon"], ["signout", "Sign out", "power"], ["restart", "Restart", "power"], ["shutdown", "Shut down", "power"]];
    panel.innerHTML = `<h2>Power</h2><div class="plist">${A.map(([a, n, i]) => `<button data-a="${a}">${ico(i)}<span class="grow" style="text-align:left">${n}</span></button>`).join("")}</div>`;
    panel.querySelector(".plist").onclick = (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.dataset.a;
      if (["signout", "restart", "shutdown"].includes(a) && !b.classList.contains("confirm")) { b.classList.add("confirm"); b.querySelector("span").textContent += " — click again"; return; }
      invoke("system_action", { action: a }); hide();
    };
  };

  VIEWS.system = async () => {
    invoke("stats_enable", { on: true });
    cleanup.push(() => invoke("stats_enable", { on: false }));
    panel.innerHTML = `<h2>System</h2><div class="empty">Measuring…</div>`;
    const meter = (p) => `<div class="meter"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
    cleanup.push(await listen("stats", (s) => {
      panel.innerHTML = `<h2>System</h2>
        <div><div class="stat"><span>CPU</span><b>${Math.round(s.cpu)}%</b></div>${meter(s.cpu)}</div>
        <div><div class="stat"><span>Memory</span><b>${s.ram_used_gb.toFixed(1)} / ${s.ram_total_gb.toFixed(1)} GB</b></div>${meter(s.ram_pct)}</div>
        <div><div class="stat"><span>System drive</span><b>${Math.round(s.disk_free_gb)} GB free of ${Math.round(s.disk_total_gb)}</b></div>${meter(100 - s.disk_free_gb / (s.disk_total_gb || 1) * 100)}</div>
        <div class="stat"><span>Network</span><b>↓ ${G.fmtRate(s.net_down)} · ↑ ${G.fmtRate(s.net_up)}</b></div>
        <div class="stat"><span>Battery</span><b>${s.battery == null ? "None (desktop)" : s.battery + "%" + (s.charging ? ", charging" : "")}</b></div>
        <div class="stat"><span>Up for</span><b>${Math.floor(s.uptime_s / 86400)}d ${Math.floor(s.uptime_s % 86400 / 3600)}h ${Math.floor(s.uptime_s % 3600 / 60)}m</b></div>
        <button class="btn" id="tm">Open Task Manager</button>`;
      panel.querySelector("#tm").onclick = () => { invoke("system_action", { action: "taskmgr" }); hide(); };
    }));
  };

  VIEWS.recycle = async () => {
    const [n, bytes] = await invoke("recycle_info");
    panel.innerHTML = `<h2>Recycle Bin</h2><div>${n ? `${n} item${n === 1 ? "" : "s"} · ${G.fmtBytes(bytes)}` : "Empty"}</div>
      <div class="row"><button class="btn" id="op">Open</button><button class="btn danger" id="em" ${n ? "" : "disabled"}>Empty…</button></div><div class="muted">Windows asks before emptying.</div>`;
    panel.querySelector("#op").onclick = () => { invoke("system_action", { action: "recycle-open" }); hide(); };
    panel.querySelector("#em").onclick = () => { hide(); invoke("system_action", { action: "recycle-empty" }); };
  };

  VIEWS.allapps = async () => {
    panel.innerHTML = `<label class="sbox">${ico("search")}<input id="f" type="text" placeholder="Filter apps" autocomplete="off"></label><div class="scroll"><div class="apgrid" id="g"><div class="empty">Loading apps…</div></div></div>`;
    let apps = await invoke("all_apps");
    for (let i = 0; !apps.length && i < 10; i++) { await new Promise((r) => setTimeout(r, 400)); apps = await invoke("all_apps"); }
    const g = panel.querySelector("#g"), f = panel.querySelector("#f");
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { const el = e.target; io.unobserve(el); icon(el.dataset.icon, 48).then((s) => { if (s) el.outerHTML = `<img src="${s}" alt="">`; }); } }));
    function draw() {
      const q = f.value.trim().toLowerCase();
      const list = apps.filter((a) => !q || a.name.toLowerCase().includes(q));
      g.innerHTML = list.map((a, i) => `<button data-i="${apps.indexOf(a)}" title="${esc(a.name)}"><span class="ph" data-icon="${esc(a.exe || a.launch)}"></span><span>${esc(a.name)}</span></button>`).join("") || `<div class="empty">No apps match.</div>`;
      g.querySelectorAll("[data-icon]").forEach((el) => io.observe(el));
    }
    g.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) { invoke("app_launch", { target: apps[+b.dataset.i].launch }); hide(); } };
    g.oncontextmenu = (e) => { const b = e.target.closest("[data-i]"); if (b) { const a = apps[+b.dataset.i]; invoke("app_menu", { pin: { name: a.name, launch: a.launch, exe: a.exe } }); } };
    f.oninput = draw; draw(); setTimeout(() => f.focus(), 30);
    cleanup.push(() => io.disconnect());
  };

  VIEWS.currency = () => {
    const C = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "MXN", "BRL", "SEK", "NOK", "DKK", "PLN", "KRW", "SGD", "HKD", "NZD", "ZAR", "TRY"];
    const opt = (sel) => C.map((c) => `<option ${c === sel ? "selected" : ""}>${c}</option>`).join("");
    panel.innerHTML = `<h2>Currency</h2><div class="row"><input id="a" type="number" value="1" class="grow"><select id="f">${opt(S.currency_from)}</select></div>
      <div class="row"><span class="grow"></span><button class="btn" id="sw" aria-label="Swap">⇅</button><select id="t">${opt(S.currency_to)}</select></div><div class="answer"><b id="r">…</b><span class="muted" id="d"></span></div>`;
    const a = panel.querySelector("#a"), f = panel.querySelector("#f"), t = panel.querySelector("#t");
    async function calcIt() {
      const r = await G.currency(`${a.value || 0} ${f.value} to ${t.value}`).catch(() => null);
      panel.querySelector("#r").textContent = r ? r.text : f.value === t.value ? "Pick two different currencies" : "Couldn't load rates";
      panel.querySelector("#d").textContent = r ? r.sub : "";
    }
    a.oninput = f.onchange = t.onchange = calcIt;
    panel.querySelector("#sw").onclick = () => { [f.value, t.value] = [t.value, f.value]; calcIt(); };
    calcIt();
  };

  // ================================================================== boot
  listen("route", (r) => show(r));
  listen("settings", (s) => { S = s; applyTheme(s); });
  show(decodeURIComponent(location.hash.slice(1)) || "search");
})();
