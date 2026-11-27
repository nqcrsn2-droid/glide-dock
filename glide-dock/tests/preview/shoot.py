# Screenshots of the UI with fake data: python3 tests/preview/shoot.py <outdir>
import sys, pathlib, asyncio
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parents[2] / "ui"
mock = (pathlib.Path(__file__).parent / "mock-tauri.js").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/gd-shots"); out.mkdir(parents=True, exist_ok=True)
BG = "linear-gradient(135deg,#2b4b7c,#7a3d6b 60%,#c06c4b)"
SHOTS = [("bar", "bar.html", 1400, 64, None), ("popup-search", "popup.html#search", 640, 460, "type:vi"), ("popup-calendar", "popup.html#calendar", 340, 470, None),
         ("popup-toggles", "popup.html#toggles", 380, 430, None), ("popup-weather", "popup.html#weather", 360, 470, None), ("popup-media", "popup.html#media", 320, 380, None),
         ("popup-system", "popup.html#system", 340, 360, None), ("popup-timer", "popup.html#timer", 320, 330, None), ("popup-search-calc", "popup.html#search", 640, 460, "type:15% * 340"),
         ("settings-widgets", "settings.html#widgets", 900, 700, None), ("settings-appearance", "settings.html#appearance", 900, 620, None)]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome")
        for name, url, w, h, act in SHOTS:
            pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1.5)
            errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
            await pg.add_init_script(mock)
            await pg.add_init_script(f"addEventListener('DOMContentLoaded',()=>{{ if(!location.pathname.endsWith('settings.html')) document.body.style.background='{BG}'; }})")
            await pg.goto((root / url.split("#")[0]).as_uri() + ("#" + url.split("#")[1] if "#" in url else ""))
            await pg.wait_for_timeout(600)
            if act and act.startswith("type:"):
                await pg.fill("#q", act[5:]); await pg.wait_for_timeout(400)
            await pg.screenshot(path=str(out / f"{name}.png"))
            print(name, "errors:", errs or "none")
        await b.close()
asyncio.run(main())
