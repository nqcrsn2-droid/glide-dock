// Shared helpers for the bar, popup and settings pages. No dependencies.
(() => {
  const T = window.__TAURI__;
  const invoke = (cmd, args) => (T ? T.core.invoke(cmd, args) : Promise.reject(new Error("not in app")));
  const listen = (ev, fn) => (T ? T.event.listen(ev, (e) => fn(e.payload)) : Promise.resolve(() => {}));

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- cached web requests (shared between the bar and popup through localStorage) ----------
  async function cachedGet(url, ttlMs) {
    const key = "gd:get:" + url;
    try {
      const c = JSON.parse(localStorage.getItem(key) || "null");
      if (c && Date.now() - c.t < ttlMs) return c.v;
    } catch {}
    const v = await invoke("http_get", { url });
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  }
  async function cachedJson(url, ttlMs) { return JSON.parse(await cachedGet(url, ttlMs)); }

  // ---------- icons ----------
  const iconCache = new Map();
  function icon(target, size = 48) {
    const k = size + "|" + target;
    if (!iconCache.has(k)) iconCache.set(k, invoke("get_icon", { target, size }).catch(() => null));
    return iconCache.get(k);
  }

  // ---------- formatting ----------
  const fmtBytes = (b) => {
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; b = +b || 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + " " + u[i];
  };
  const fmtRate = (b) => fmtBytes(b) + "/s";
  const fmtDur = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  };
  const timeStr = (d, s, opt = {}) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !s.clock_24h, ...opt });

  // ---------- weather (Open-Meteo, no key) ----------
  const WMO = {
    0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Cloudy", "☁️"],
    45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Drizzle", "🌦️"],
    56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"], 61: ["Light rain", "🌧️"], 63: ["Rain", "🌧️"],
    65: ["Heavy rain", "🌧️"], 66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"], 71: ["Light snow", "🌨️"],
    73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"], 80: ["Showers", "🌦️"], 81: ["Showers", "🌦️"],
    82: ["Heavy showers", "⛈️"], 85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"], 95: ["Thunderstorm", "⛈️"],
    96: ["Thunderstorm, hail", "⛈️"], 99: ["Thunderstorm, hail", "⛈️"],
  };
  const wmo = (c) => WMO[c] || ["—", "🌡️"];
  async function geocode(name) {
    const j = await cachedJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name)}`, 7 * 864e5);
    const r = j.results && j.results[0];
    return r ? { name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude } : null;
  }
  async function weather(lat, lon, units) {
    const imp = units !== "metric";
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
      `&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&forecast_days=7&timezone=auto` + (imp ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "");
    return cachedJson(u, 25 * 60e3);
  }

  // ---------- calendar (ICS) ----------
  function parseIcsDate(v, params) {
    if (!v) return null;
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (!h) return { date: new Date(+y, +mo - 1, +d), allDay: true };
    if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
    const tz = (params || "").match(/TZID=([^;:]+)/);
    if (tz) {
      // wall time in a named zone -> find the UTC instant that shows that wall time there
      const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      try {
        const f = new Intl.DateTimeFormat("en-US", { timeZone: tz[1], hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
        const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
        return { date: new Date(guess - (shown - guess)), allDay: false };
      } catch {}
    }
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  }
  function parseIcs(text) {
    const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
    const evs = []; let cur = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") { if (cur && cur.start) evs.push(cur); cur = null; continue; }
      if (!cur) continue;
      const i = line.indexOf(":"); if (i < 0) continue;
      const head = line.slice(0, i), val = line.slice(i + 1);
      const [name, ...ps] = head.split(";"); const params = ps.join(";");
      const unesc = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
      if (name === "SUMMARY") cur.title = unesc(val);
      else if (name === "LOCATION") cur.location = unesc(val);
      else if (name === "DTSTART") { const d = parseIcsDate(val, params); if (d) { cur.start = d.date; cur.allDay = d.allDay; } }
      else if (name === "DTEND") { const d = parseIcsDate(val, params); if (d) cur.end = d.date; }
      else if (name === "RRULE") cur.rrule = val;
      else if (name === "EXDATE") (cur.exdates = cur.exdates || []).push(...val.split(",").map((v) => +parseIcsDate(v, params)?.date));
      else if (name === "STATUS" && val === "CANCELLED") cur.cancelled = true;
    }
    return evs.filter((e) => !e.cancelled);
  }
  // Expand events (with simple RRULEs: DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY for weekly) into [from, to).
  function expand(evs, from, to) {
    const out = [];
    const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    for (const e of evs) {
      const dur = (e.end ? +e.end : +e.start + (e.allDay ? 864e5 : 36e5)) - +e.start;
      const push = (s) => { if (+s < +to && +s + dur > +from && !(e.exdates || []).includes(+s)) out.push({ ...e, start: new Date(s), end: new Date(+s + dur) }); };
      if (!e.rrule) { push(e.start); continue; }
      const r = Object.fromEntries(e.rrule.split(";").map((kv) => kv.split("=")));
      const iv = Math.max(1, +r.INTERVAL || 1);
      const until = r.UNTIL ? parseIcsDate(r.UNTIL)?.date : null;
      let count = r.COUNT ? +r.COUNT : Infinity;
      const end = until && +until < +to ? until : to;
      const byday = r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : null;
      let d = new Date(e.start); let guard = 0;
      while (+d <= +end && count > 0 && guard++ < 5000) {
        if (r.FREQ === "WEEKLY" && byday) {
          const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay());
          for (const wd of byday.sort()) {
            const x = new Date(weekStart); x.setDate(weekStart.getDate() + wd);
            x.setHours(e.start.getHours(), e.start.getMinutes(), e.start.getSeconds());
            if (+x >= +e.start && +x <= +end && count > 0) { push(x); count--; }
          }
          d.setDate(d.getDate() + 7 * iv); continue;
        }
        push(new Date(d)); count--;
        if (r.FREQ === "DAILY") d.setDate(d.getDate() + iv);
        else if (r.FREQ === "WEEKLY") d.setDate(d.getDate() + 7 * iv);
        else if (r.FREQ === "MONTHLY") d.setMonth(d.getMonth() + iv);
        else if (r.FREQ === "YEARLY") d.setFullYear(d.getFullYear() + iv);
        else break;
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
  async function calendarEvents(settings, from, to) {
    const all = [];
    for (const url of settings.calendars || []) {
      try { all.push(...parseIcs(await cachedGet(url.replace(/^webcal:/, "https:"), 15 * 60e3))); } catch {}
    }
    return expand(all, from, to);
  }

  // ---------- calculator: + - * / ^ % ( ), functions, constants. No eval. ----------
  function calc(src) {
    const s = src.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "");
    if (!/^[0-9a-z.+\-*/^%()]+$/i.test(s) || !/[0-9pie]/i.test(s)) return null;
    let i = 0;
    const F = { sqrt: Math.sqrt, sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
    const peek = () => s[i];
    function num() {
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      const w = s.slice(i).match(/^[a-z]+/i);
      if (w) {
        const n = w[0].toLowerCase(); i += w[0].length;
        if (n === "pi") return Math.PI;
        if (n === "e") return Math.E;
        if (F[n]) { const v = atom(); return F[n](v); }
        throw 0;
      }
      throw 0;
    }
    function atom() {
      if (peek() === "(") { i++; const v = expr(); if (peek() !== ")") throw 0; i++; return v; }
      if (peek() === "-") { i++; return -atom(); }
      if (peek() === "+") { i++; return atom(); }
      return num();
    }
    function power() { let b = atom(); while (peek() === "%") { i++; b = b / 100; } if (peek() === "^") { i++; return Math.pow(b, power()); } return b; }
    function term() { let v = power(); while (peek() === "*" || peek() === "/" || (peek() && /[0-9(a-z]/i.test(peek()) && i > 0)) { const op = peek(); if (op === "*" || op === "/") i++; const r = power(); v = op === "/" ? v / r : v * r; } return v; }
    function expr() { let v = term(); while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; } return v; }
    try {
      const v = expr();
      if (i !== s.length || !isFinite(v)) return null;
      if (/^[\d.]+$/.test(s)) return null; // a bare number isn't a calculation
      return +v.toPrecision(12);
    } catch { return null; }
  }

  // ---------- unit conversion ----------
  const UNITS = {
    length: { m: 1, meter: 1, meters: 1, km: 1000, kilometer: 1000, kilometers: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, yard: 0.9144, yards: 0.9144, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 },
    mass: { kg: 1, kilogram: 1, kilograms: 1, g: 0.001, gram: 0.001, grams: 0.001, mg: 1e-6, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523125, ounce: 0.028349523125, ounces: 0.028349523125, st: 6.35029318, stone: 6.35029318, t: 1000, ton: 907.18474, tons: 907.18474 },
    volume: { l: 1, liter: 1, liters: 1, litre: 1, ml: 0.001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, qt: 0.946352946, quart: 0.946352946, pt: 0.473176473, pint: 0.473176473, cup: 0.2365882365, cups: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478, tsp: 0.00492892159 },
    speed: { "m/s": 1, mps: 1, kph: 1 / 3.6, "km/h": 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444, knots: 0.514444 },
    data: { b: 1, byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
    time: { s: 1, sec: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800, year: 31557600, years: 31557600 },
    area: { m2: 1, sqm: 1, km2: 1e6, ft2: 0.09290304, sqft: 0.09290304, acre: 4046.8564224, acres: 4046.8564224, ha: 1e4, hectare: 1e4, hectares: 1e4 },
  };
  const TEMP = { c: "C", celsius: "C", f: "F", fahrenheit: "F", k: "K", kelvin: "K" };
  function convert(q) {
    const m = q.trim().toLowerCase().match(/^(-?[\d.,]+)\s*([a-z°/0-9]+)\s+(?:to|in|as|=)\s+([a-z°/0-9]+)$/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, "")); const a = m[2].replace("°", ""), b = m[3].replace("°", "");
    if (TEMP[a] && TEMP[b]) {
      const toC = { C: (x) => x, F: (x) => (x - 32) * 5 / 9, K: (x) => x - 273.15 }[TEMP[a]](v);
      const r = { C: (x) => x, F: (x) => x * 9 / 5 + 32, K: (x) => x + 273.15 }[TEMP[b]](toC);
      return { value: +r.toFixed(2), text: `${v}°${TEMP[a]} = ${+r.toFixed(2)}°${TEMP[b]}` };
    }
    for (const t of Object.values(UNITS)) if (t[a] && t[b]) {
      const r = v * t[a] / t[b];
      return { value: +r.toPrecision(8), text: `${v} ${a} = ${+r.toPrecision(8)} ${b}` };
    }
    return null;
  }

  // ---------- currency (Frankfurter, ECB rates, no key) ----------
  const CUR_SYM = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
  async function currency(q) {
    let s = q.trim().toLowerCase();
    for (const [k, v] of Object.entries(CUR_SYM)) s = s.split(k).join(" " + v.toLowerCase() + " ");
    const m = s.match(/^\s*([\d.,]+)\s*([a-z]{3})\s+(?:to|in|=)\s+([a-z]{3})\s*$/) || s.match(/^\s*([a-z]{3})\s*([\d.,]+)\s+(?:to|in|=)\s+([a-z]{3})\s*$/);
    if (!m) return null;
    let [, x, y, to] = m; if (/^[a-z]/.test(x)) [x, y] = [y, x];
    const amt = parseFloat(x.replace(/,/g, "")); const from = y.toUpperCase(); to = to.toUpperCase();
    if (from === to) return null;
    const j = await cachedJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, 3 * 36e5);
    const rate = j.rates && j.rates[to];
    if (!rate) return null;
    const r = amt * rate;
    return { text: `${amt.toLocaleString()} ${from} = ${r.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`, sub: `ECB rate ${j.date} · 1 ${from} = ${rate} ${to}` };
  }

  // ---------- time zones ----------
  const CITY_TZ = {
    "new york": "America/New_York", nyc: "America/New_York", "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", "san francisco": "America/Los_Angeles",
    seattle: "America/Los_Angeles", chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", denver: "America/Denver", phoenix: "America/Phoenix",
    miami: "America/New_York", toronto: "America/Toronto", vancouver: "America/Vancouver", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo",
    "buenos aires": "America/Argentina/Buenos_Aires", london: "Europe/London", dublin: "Europe/Dublin", paris: "Europe/Paris", berlin: "Europe/Berlin", madrid: "Europe/Madrid",
    rome: "Europe/Rome", milan: "Europe/Rome", amsterdam: "Europe/Amsterdam", zurich: "Europe/Zurich", stockholm: "Europe/Stockholm", athens: "Europe/Athens",
    istanbul: "Europe/Istanbul", moscow: "Europe/Moscow", dubai: "Asia/Dubai", riyadh: "Asia/Riyadh", "tel aviv": "Asia/Jerusalem", cairo: "Africa/Cairo",
    johannesburg: "Africa/Johannesburg", lagos: "Africa/Lagos", nairobi: "Africa/Nairobi", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", india: "Asia/Kolkata",
    bangkok: "Asia/Bangkok", singapore: "Asia/Singapore", "hong kong": "Asia/Hong_Kong", shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai", taipei: "Asia/Taipei",
    seoul: "Asia/Seoul", tokyo: "Asia/Tokyo", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", auckland: "Pacific/Auckland", honolulu: "Pacific/Honolulu",
    utc: "UTC", gmt: "UTC", est: "America/New_York", edt: "America/New_York", cst: "America/Chicago", cdt: "America/Chicago", mst: "America/Denver", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", cet: "Europe/Paris", jst: "Asia/Tokyo",
  };
  function timeIn(q) {
    const m = q.trim().toLowerCase().match(/^(?:what(?:'s| is) the )?time (?:in|at) (.+?)\??$/) || q.trim().toLowerCase().match(/^(.+?) time\??$/);
    if (!m) return null;
    const place = m[1].trim(); const tz = CITY_TZ[place] || (place.includes("/") ? place : null);
    if (!tz) return null;
    try {
      const now = new Date();
      const t = now.toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" });
      const d = now.toLocaleDateString([], { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
      return { text: `${t} in ${place.replace(/\b\w/g, (c) => c.toUpperCase())}`, sub: `${d} · ${tz}` };
    } catch { return null; }
  }

  window.GD = { invoke, listen, esc, cachedGet, cachedJson, icon, fmtBytes, fmtRate, fmtDur, timeStr, wmo, geocode, weather, parseIcs, expand, calendarEvents, calc, convert, currency, timeIn, CITY_TZ };
})();
