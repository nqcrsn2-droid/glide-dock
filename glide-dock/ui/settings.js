// Settings window. Every change is saved straight away and the bar redraws live.
(() => {
  const G = window.GD, { invoke, listen, esc, icon } = G;
  const { list: WIDGETS, byId, ico, TOGGLES } = window.GDW;
  const page = document.getElementById("page");
  let S = null, tab = "appearance", saveTimer = 0;

  function theme() {
    const light = S.theme === "light" || (S.theme === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.classList.toggle("light", light);
    document.documentElement.style.setProperty("--accent", S.accent);
  }
  function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 1400); }
  function save(patch, redraw = false) {
    Object.assign(S, patch);
    theme();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { S = await invoke("save_settings", { settings: S }); toast("Saved"); if (redraw) render(); } catch (e) { toast("Couldn't save: " + e); }
    }, 180);
    if (redraw) render();
  }

  // ------------------------------------------------------------- controls
  const sw = (key, label, help = "") => `<div class="set"><div class="lab">${label}${help ? `<small>${help}</small>` : ""}</div><button class="sw ${S[key] ? "on" : ""}" data-sw="${key}" role="switch" aria-checked="${!!S[key]}" aria-label="${esc(label)}"></button></div>`;
  const range = (key, label, min, max, step = 1, fmt = (v) => v, help = "") => `<div class="set"><div class="lab">${label}${help ? `<small>${help}</small>` : ""}</div><input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${S[key]}" aria-label="${esc(label)}"><span class="val" data-val="${key}">${fmt(S[key])}</span></div>`;
  const sel = (key, label, opts, help = "") => `<div class="set"><div class="lab">${label}${help ? `<small>${help}</small>` : ""}</div><select data-sel="${key}" aria-label="${esc(label)}">${opts.map(([v, n]) => `<option value="${v}" ${S[key] === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;
  const text = (key, label, help = "", ph = "") => `<div class="set"><div class="lab">${label}${help ? `<small>${help}</small>` : ""}</div><input type="text" data-text="${key}" value="${esc(S[key])}" placeholder="${esc(ph)}" style="width:240px"></div>`;
  const FMT = { opacity: (v) => Math.round(v * 100) + "%", px: (v) => v + " px" };

  page.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sw]");
    if (b) { const k = b.dataset.sw; save({ [k]: !S[k] }); b.classList.toggle("on", S[k]); b.setAttribute("aria-checked", S[k]); }
  });
  page.addEventListener("input", (e) => {
    const r = e.target.dataset.range;
    if (r) { const v = parseFloat(e.target.value); save({ [r]: v }); const f = r === "opacity" ? FMT.opacity : FMT.px; page.querySelector(`[data-val="${r}"]`).textContent = f(v); }
    if (e.target.dataset.color) save({ accent: e.target.value });
  });
  page.addEventListener("change", (e) => {
    const k = e.target.dataset.sel || e.target.dataset.text;
    if (k) save({ [k]: e.target.value }, !!e.target.dataset.sel);
  });

  // ------------------------------------------------------------- pages
  const PAGES = {};
  PAGES.appearance = () => `<h1>Appearance</h1><p class="lead">Changes show on the dock straight away.</p>
    <div class="card">
      ${sel("theme", "Theme", [["dark", "Dark"], ["light", "Light"], ["auto", "Match Windows"]])}
      <div class="set"><div class="lab">Accent colour</div><input type="color" data-color="1" value="${S.accent}" aria-label="Accent colour"></div>
      ${range("opacity", "Background opacity", 0.2, 1, 0.01, FMT.opacity)}
      ${range("dock_height", "Dock height", 44, 120, 1, FMT.px)}
      ${range("icon_size", "App icon size", 24, 80, 1, FMT.px)}
      ${range("corner_radius", "Corner roundness", 0, 40, 1, FMT.px)}
      ${range("margin", "Gap from screen edge", 0, 30, 1, FMT.px)}
      ${sw("magnify", "Magnify icons under the pointer")}
    </div>`;

  PAGES.widgets = () => {
    const used = new Set([...S.left, ...S.right]);
    const zone = (side) => S[side].map((id, i) => { const w = byId[id]; if (!w) return ""; return `<div class="li"><span class="ph">${widgetIcon(w)}</span><div class="grow">${esc(w.name)}</div><div class="acts">
      <button class="btn small" data-mv="${side}:${i}:-1" aria-label="Move left" ${i === 0 ? "disabled" : ""}>←</button><button class="btn small" data-mv="${side}:${i}:1" aria-label="Move right" ${i === S[side].length - 1 ? "disabled" : ""}>→</button>
      <button class="btn small" data-sw2="${side}:${i}" aria-label="Move to other side">${side === "left" ? "To right" : "To left"}</button><button class="btn small" data-rm="${side}:${i}" aria-label="Remove">✕</button></div></div>`; }).join("") || `<div class="li muted">Empty</div>`;
    const cats = [...new Set(WIDGETS.map((w) => w.cat))];
    return `<h1>Widgets</h1><p class="lead">${WIDGETS.length} widgets. Add them to the left or right of your apps. Click a widget on the dock to open its panel.</p>
      <div class="cols"><div><h3>Left side</h3><div class="card zone">${zone("left")}</div></div><div><h3>Right side</h3><div class="card zone">${zone("right")}</div></div></div>
      <h3>Quick toggle pills (up to 4)</h3><div class="chips">${Object.entries(TOGGLES).map(([id, d]) => `<button class="chip ${S.toggles.includes(id) ? "on" : ""}" data-tg="${id}">${esc(d.name)}</button>`).join("")}</div>
      <h3>Library</h3><input type="text" id="lf" placeholder="Filter widgets" style="width:260px;margin-bottom:10px">
      ${cats.map((c) => `<h3 data-cat="${c}">${c}</h3><div class="lib">${WIDGETS.filter((w) => w.cat === c).map((w) => `<div class="lw" data-name="${esc((w.name + " " + w.desc).toLowerCase())}"><span class="ic">${widgetIcon(w)}</span><div class="grow"><b>${esc(w.name)}</b><small>${esc(w.desc)}</small>
        ${used.has(w.id) && !w.multi ? `<span class="used">On the dock</span>` : `<button class="btn small" data-add="left:${w.id}">Add left</button> <button class="btn small" data-add="right:${w.id}">Add right</button>`}</div></div>`).join("")}</div>`).join("")}`;
  };
  function widgetIcon(w) {
    const m = { search: "search", toggles: "toggles", clock: "clock", media: "music", volume: "speaker", mic: "mic", weather: "sun", nextevent: "cal", worldclock: "globe", currency: "cash", date: "cal", cpu: "cpu", ram: "ram", network: "net", battery: "battery", disk: "disk", uptime: "pulse", notes: "note", timer: "timer", screenshot: "shot", showdesktop: "desktop", recycle: "trash", downloads: "down", allapps: "grid", taskmgr: "task", keepawake: "coffee", lock: "lock", power: "power", settings: "gear", divider: "chevron", spacer: "chevron" };
    return ico(m[w.id] || "grid");
  }
  page.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mv],[data-rm],[data-add],[data-sw2],[data-tg],[data-unpin],[data-pmv]");
    if (!t) return;
    const d = t.dataset;
    if (d.add) { const [side, id] = d.add.split(":"); save({ [side]: [...S[side], id] }, true); }
    if (d.rm) { const [side, i] = d.rm.split(":"); const a = [...S[side]]; a.splice(+i, 1); save({ [side]: a }, true); }
    if (d.mv) { const [side, i, dir] = d.mv.split(":"); const a = [...S[side]]; const j = +i + +dir; [a[+i], a[j]] = [a[j], a[+i]]; save({ [side]: a }, true); }
    if (d.sw2) { const [side, i] = d.sw2.split(":"); const other = side === "left" ? "right" : "left"; const a = [...S[side]]; const [id] = a.splice(+i, 1); save({ [side]: a, [other]: side === "left" ? [id, ...S[other]] : [...S[other], id] }, true); }
    if (d.tg) { const has = S.toggles.includes(d.tg); if (!has && S.toggles.length >= 4) { toast("Up to 4 pills — remove one first"); return; } save({ toggles: has ? S.toggles.filter((x) => x !== d.tg) : [...S.toggles, d.tg] }, true); }
    if (d.unpin) { const a = [...S.pinned]; a.splice(+d.unpin, 1); save({ pinned: a }, true); }
    if (d.pmv) { const [i, dir] = d.pmv.split(":").map(Number); const a = [...S.pinned]; const j = i + dir; [a[i], a[j]] = [a[j], a[i]]; save({ pinned: a }, true); }
  });
  page.addEventListener("input", (e) => {
    if (e.target.id !== "lf") return;
    const q = e.target.value.toLowerCase();
    page.querySelectorAll(".lw").forEach((el) => (el.style.display = el.dataset.name.includes(q) ? "" : "none"));
  });

  PAGES.apps = () => `<h1>Pinned apps</h1><p class="lead">Right-click any app on the dock (or in search / All apps) to pin or unpin it. Drag icons on the dock to reorder, or use the arrows here.</p>
    <div class="card">${S.pinned.map((p, i) => `<div class="li"><span class="ph" data-icon="${esc(p.exe || p.launch)}"></span><div class="grow">${esc(p.name)}<small>${esc(p.launch)}</small></div><div class="acts">
      <button class="btn small" data-pmv="${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="btn small" data-pmv="${i}:1" ${i === S.pinned.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button class="btn small" data-unpin="${i}" aria-label="Unpin">Unpin</button></div></div>`).join("") || `<div class="li muted">Nothing pinned.</div>`}</div>
    <h3>Add an app</h3><input type="text" id="af" placeholder="Type an app name…" style="width:300px"><div class="card" id="ares" style="margin-top:8px"></div>`;

  PAGES.behaviour = () => `<h1>Behaviour</h1>
    <div class="card">
      ${sw("hide_windows_taskbar", "Auto-hide the Windows taskbar", "Uses Windows' own “Automatically hide the taskbar” setting. Put back when Glide Dock quits, or from the tray icon.")}
      ${sw("hide_in_fullscreen", "Hide the dock for full-screen apps and games", "The dock also stops all its updates while hidden.")}
      ${sel("monitors", "Show the dock on", [["primary", "Main monitor only"], ["all", "Every monitor"]], "Each extra monitor adds one more small web view (about 20–40 MB).")}
      <div class="set"><div class="lab">Start with Windows</div><button class="sw" id="auto" role="switch" aria-label="Start with Windows"></button></div>
      ${text("search_hotkey", "Search shortcut", "For example Alt+Space, Ctrl+Shift+Space. Leave empty for none.", "Alt+Space")}
      ${sw("file_search", "Search files", "Indexes file names (not contents) in Desktop, Documents, Downloads, Pictures, Videos and Music, in memory only.")}
      ${sw("clock_seconds", "Show seconds on the clock")}
      ${sw("clock_24h", "24-hour clock")}
    </div>`;

  PAGES.data = () => `<h1>Weather & calendar</h1><p class="lead">Weather comes from Open-Meteo and rates from the European Central Bank via Frankfurter — free, no account, no tracking. Calendars are read-only links you paste here.</p>
    <h3>Weather</h3><div class="card">
      <div class="set"><div class="lab">City<small>${S.weather_city ? "Now: " + esc(S.weather_city) : "Not set"}</small></div><input type="text" id="city" placeholder="City name" style="width:200px"><button class="btn primary" id="setcity">Set</button></div>
      ${sel("units", "Units", [["imperial", "°F, mph"], ["metric", "°C, km/h"]])}
    </div>
    <h3>Calendars</h3><div class="card"><div class="set"><div class="lab">ICS links, one per line<small>Google Calendar: Settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Shared calendars → Publish → ICS. iCloud: share calendar → Public. Treat these links like passwords.</small></div></div>
      <textarea id="cals" rows="4" style="width:100%;margin-bottom:12px" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics">${esc(S.calendars.join("\n"))}</textarea></div>
    <h3>Other</h3><div class="card">
      ${text("world_tz", "World clock time zone", "IANA name, e.g. Europe/London, Asia/Tokyo, America/Los_Angeles")}
      ${text("currency_from", "Exchange rate: from", "3-letter code, e.g. USD")}
      ${text("currency_to", "Exchange rate: to", "3-letter code, e.g. EUR")}
    </div>`;

  PAGES.about = () => `<h1>About Glide Dock</h1><p class="lead" id="ver">Free and open source (MIT). No account, no ads, no telemetry. The only network requests are the weather, exchange-rate and calendar links you turn on.</p>
    <div class="card">
      <div class="set"><div class="lab">Windows taskbar<small>If the taskbar ever stays hidden, this puts it back.</small></div><button class="btn" id="rt">Restore taskbar</button></div>
      <div class="set"><div class="lab">Settings and notes folder<small id="dd"></small></div><button class="btn" id="df">Open folder</button></div>
      <div class="set"><div class="lab">Reset all settings<small>Puts everything back to how it was on first start.</small></div><button class="btn" id="rs">Reset…</button></div>
      <div class="set"><div class="lab">Quit Glide Dock</div><button class="btn" id="qt">Quit</button></div>
    </div>
    <h3>Built with</h3><p class="muted">Tauri (MIT/Apache-2.0), windows-rs (MIT/Apache-2.0), serde (MIT/Apache-2.0), png (MIT/Apache-2.0), base64 (MIT/Apache-2.0). Weather: Open-Meteo (CC BY 4.0). Rates: Frankfurter / ECB.</p>`;

  async function render() {
    document.querySelectorAll("#tabs [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    page.innerHTML = PAGES[tab]();
    page.querySelectorAll("[data-icon]").forEach((el) => icon(el.dataset.icon, 32).then((s) => { if (s) el.outerHTML = `<img src="${s}" alt="">`; }));
    const T = window.__TAURI__;
    if (tab === "behaviour" && T) {
      const a = page.querySelector("#auto");
      const on = await T.core.invoke("plugin:autostart|is_enabled").catch(() => false);
      a.classList.toggle("on", on);
      a.onclick = async () => { const now = !a.classList.contains("on"); await T.core.invoke(now ? "plugin:autostart|enable" : "plugin:autostart|disable").catch((e) => toast(String(e))); a.classList.toggle("on", now); toast("Saved"); };
    }
    if (tab === "apps") {
      const f = page.querySelector("#af"), res = page.querySelector("#ares");
      let all = await invoke("all_apps").catch(() => []);
      f.oninput = () => {
        const q = f.value.trim().toLowerCase();
        const l = q ? all.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8) : [];
        res.innerHTML = l.map((a, i) => `<div class="li"><span class="ph" data-icon="${esc(a.exe || a.launch)}"></span><div class="grow">${esc(a.name)}</div><button class="btn small" data-pin="${all.indexOf(a)}">Pin</button></div>`).join("") || (q ? `<div class="li muted">No apps match.</div>` : "");
        res.querySelectorAll("[data-icon]").forEach((el) => icon(el.dataset.icon, 32).then((s) => { if (s) el.outerHTML = `<img src="${s}" alt="">`; }));
      };
      res.onclick = (e) => { const b = e.target.closest("[data-pin]"); if (!b) return; const a = all[+b.dataset.pin]; if (S.pinned.some((p) => p.launch === a.launch)) { toast("Already pinned"); return; } save({ pinned: [...S.pinned, { name: a.name, launch: a.launch, exe: a.exe }] }, true); };
      if (!all.length) setTimeout(async () => { all = await invoke("all_apps").catch(() => []); }, 1500);
    }
    if (tab === "data") {
      const go = async () => {
        const v = page.querySelector("#city").value.trim(); if (!v) return;
        try { const g = await G.geocode(v); if (!g) { toast("City not found"); return; } save({ weather_city: g.name, weather_lat: g.lat, weather_lon: g.lon }, true); } catch (e) { toast("Couldn't look that up: " + e); }
      };
      page.querySelector("#setcity").onclick = go;
      page.querySelector("#city").onkeydown = (e) => e.key === "Enter" && go();
      page.querySelector("#cals").onchange = (e) => save({ calendars: e.target.value.split(/\s+/).map((x) => x.trim()).filter(Boolean) });
    }
    if (tab === "about") {
      const info = await invoke("app_info").catch(() => ({}));
      page.querySelector("#ver").insertAdjacentHTML("afterbegin", `<b>Version ${esc(info.version || "")}${info.portable ? " (portable)" : ""}.</b> `);
      page.querySelector("#dd").textContent = info.data || "";
      page.querySelector("#rt").onclick = () => { save({ hide_windows_taskbar: false }); toast("Taskbar restored"); };
      page.querySelector("#df").onclick = () => invoke("open_data_folder");
      page.querySelector("#rs").onclick = (e) => {
        if (!e.target.dataset.sure) { e.target.dataset.sure = 1; e.target.textContent = "Click again to reset"; return; }
        invoke("save_settings", { settings: { pins_initialised: false } }).then((s) => { S = s; theme(); render(); toast("Reset"); });
      };
      page.querySelector("#qt").onclick = () => invoke("quit");
    }
  }

  document.getElementById("tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } };
  listen("tab", (t) => { if (PAGES[t]) { tab = t; render(); } });
  listen("settings", (s) => { S = s; theme(); if (!page.contains(document.activeElement) || document.activeElement === document.body) render(); });
  (async () => {
    S = await invoke("get_settings");
    const h = location.hash.slice(1); if (PAGES[h]) tab = h;
    theme(); render();
  })();
})();
