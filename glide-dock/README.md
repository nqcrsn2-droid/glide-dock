# Glide Dock

A lightweight smart dock and taskbar for Windows 10 and 11. Free and open source (MIT), with no account, ads or telemetry.

## What it does

- **Apps:** pinned and running apps in one row, with magnification under the pointer and running dots (longer when an app has several windows, accent colour for the app in front).
  - **Click:** opens the app, brings it forward, minimises it, or cycles through its windows.
  - **Middle-click or Shift-click:** opens a new window.
  - **Drag:** reorders pinned apps.
  - **Right-click:** lists the app's windows, plus Pin/Unpin, New window and Close.
- **Search** (click the search pill or press **Alt+Space**):
  - Apps, both Store and desktop.
  - File names in your personal folders, with a preview.
  - Maths: `15% * 340`, `sqrt(2)^3`.
  - Units: `5 km in miles`, `100 f to c`.
  - Currency: `100 usd to eur`.
  - Time zones: `time in tokyo`.
  - Commands: `dark mode on`, `volume 40`, `timer 10 min`, `add weather widget`, `dock height 72`, `hide taskbar`, `note buy milk`, `lock`.
  - Web search.
- **31 widgets**, which you can place left or right of the apps in Settings → Widgets:
  - Clock with calendar and agenda, now playing, volume, mic mute, weather, next event, world clock, exchange rate, date.
  - CPU, memory, network speed, battery, disk space, uptime.
  - Quick note, timer/stopwatch/focus, screenshot, show desktop, Recycle Bin, Downloads, All apps, Task Manager, keep awake, lock, power, settings.
  - Divider and spacer.
- **Quick toggles:** Wi-Fi, Bluetooth, Windows dark mode, keep awake, mute, mic off, desktop icons and hide taskbar. Night light, Focus, Airplane mode and Energy saver open the right Settings page, because Windows has no public switch for them.
- **Behaviour:** hides behind full-screen apps and games and pauses all its updates while hidden. Can run on every monitor. Starts with Windows (can be turned off).

## Light on your PC

- **Event-driven:** Windows notifies the dock when windows open, close or change, when the volume or default device changes, when the song changes, and when a full-screen app starts. Nothing is polled.
- **Polling exceptions:**
  - The CPU, memory and network widgets sample every 2 seconds, and only while one of them is on the bar.
  - The clock wakes once a minute (once a second if you turn seconds on).
- **Popups:** one popup window is reused for every panel and is destroyed after two minutes unused, so it doesn't hold memory.
- **Measured numbers:** the CI build reports memory and idle CPU on a real Windows machine (`smoke.txt` in the build artifacts). WebView2, the browser engine Windows uses for apps like Widgets and Teams, is most of the memory.

## Safety with the Windows taskbar

Glide Dock never kills or patches Explorer. It only turns on Windows' own "Automatically hide the taskbar" setting, after saving your original setting to `taskbar_restore.json`.

Your original setting comes back:
- when you quit (tray icon or right-click the dock → Quit),
- any time from the tray (**Restore Windows taskbar**) or Settings → About,
- on the next start if the dock crashed or the PC lost power,
- when you uninstall.

If you delete the portable version without quitting it first, turn the setting back off yourself: Settings → Personalization → Taskbar → Taskbar behaviors → untick "Automatically hide the taskbar". Running `GlideDock.exe --cleanup` also does it.

## Install

- **Installer:** `Glide Dock_x.y.z_x64-setup.exe` installs per user, with no admin rights needed. Uninstall from Settings → Apps.
- **Portable:** unzip `GlideDock-portable.zip` anywhere and run `GlideDock.exe`. Settings stay in the `data` folder next to it. Delete `portable.txt` to use `%APPDATA%` instead.
- **Requirement:** WebView2 Runtime. It's built into Windows 11, and the installer fetches it on Windows 10 if it's missing.

## Privacy and network use

The dock only connects to the internet for the things you turn on:

| Feature | Service | What is sent |
|---|---|---|
| Weather | api.open-meteo.com (free, no key) | your city's coordinates |
| City lookup | geocoding-api.open-meteo.com | the city name you type |
| Exchange rates | api.frankfurter.dev (ECB data) | the two currency codes |
| Calendar | your own ICS links | nothing; they're downloaded |

Every other host is refused by the app itself. File search reads file names only, keeps them in memory, and never uploads them.

## Settings

Open Settings from the tray icon, by right-clicking empty space on the dock, or by starting the app again. Settings and notes are stored as plain files in `%APPDATA%\app.glidedock` (`settings.json`, `notes.md`).

## Limits

- **Not possible:**
  - Other apps' notification badges: Windows doesn't expose them to third-party docks.
  - Live window thumbnails: not implemented, to keep memory low. Right-click an app to list its windows instead.
- **Partial:** calendar recurrence supports daily, weekly (with weekdays), monthly and yearly rules with interval, count and until. Rare rules may show only the first occurrence.

## Build from source

Requires Rust (stable, MSVC target), Node 18+ and WebView2.
```
npm install
npx tauri build          # installer in src-tauri/target/release/bundle/nsis
node --test tests/lib.test.mjs
cd src-tauri && cargo test --lib
python3 tests/preview/shoot.py out/   # screenshots of every panel with sample data (needs Playwright + Chrome)
```

Every push to `main` is built on GitHub Actions (Windows). The run:
1. runs both test suites,
2. builds the installer and the portable zip,
3. runs `scripts/smoke.ps1`, which starts the dock, measures memory and idle CPU, kills it hard and checks the taskbar setting is restored,
4. uploads everything as the `glide-dock-windows` artifact.

## Layout

```
src-tauri/src/   Rust: appbar (docking), apps (window tracking), audio, media, sysinfo, system (toggles),
                 search (app list + file index), icons, net (allow-listed web requests), taskbar (safe auto-hide),
                 windows_mgr (bar/popup/settings windows), tray, settings
ui/              bar, popup and settings pages (plain HTML/CSS/JS, no framework), widgets.js = widget library
tests/           JS unit tests, UI preview with fake data
scripts/         smoke.ps1 (CI)
```

## License

MIT. Built with Tauri, windows-rs, serde, png and base64 (all MIT/Apache-2.0). Weather data by Open-Meteo.com (CC BY 4.0).
