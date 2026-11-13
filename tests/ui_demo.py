"""Drives the page in demo mode (no sign-in, no sync) in real Chrome at iPhone and iPad sizes.

Usage: python tests/ui_demo.py <base url> <screenshot folder>
Checks the screens render, Quick add adds a task, ticking a repeating task leaves a completed copy and moves the
task on, the details pane edits a title, and there are no JavaScript or Content-Security-Policy errors.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base, shots = sys.argv[1].rstrip('/') + '/', Path(sys.argv[2])
shots.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    errors = []

    # ---- iPhone size
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(base + "?demo=1")
    pg.wait_for_selector(".row")
    check("today view lists tasks", pg.locator(".row").count() >= 4, f"{pg.locator('.row').count()} rows")
    check("overdue section shown", pg.locator(".sec", has_text="Overdue").count() == 1)
    pg.screenshot(path=str(shots / "phone-1-today.png"))

    pg.fill("#quick-input", "Book flights")
    pg.keyboard.press("Enter")
    check("quick add adds to today", pg.locator(".row-title", has_text="Book flights").count() == 1)

    run = pg.locator(".row", has_text="Morning run")
    run.locator(".check").click()
    pg.wait_for_timeout(200)
    data = pg.evaluate("JSON.parse(JSON.stringify(window.__pimStore.data))")
    runs = [t for t in data["tasks"] if t["Title"] == "Morning run"]
    check("repeating task: completed copy + moved to tomorrow",
          len(runs) == 2 and sum(t["Completed"] for t in runs) == 1 and any(not t["Completed"] and t["Repeat"] == "FREQ=DAILY" for t in runs),
          str([(t["Completed"], t["StartDate"]) for t in runs]))

    pg.locator(".row", has_text="Pick up groceries").click()
    pg.wait_for_selector(".d-title")
    pg.screenshot(path=str(shots / "phone-2-detail.png"))
    pg.fill(".d-title", "Pick up groceries and flowers")
    pg.locator(".d-title").blur()
    pg.click("text=‹ Back")
    check("detail edit saved", pg.locator(".row-title", has_text="Pick up groceries and flowers").count() == 1)

    pg.click(".tab:has-text('Lists')")
    pg.wait_for_selector(".sheet-card")
    pg.screenshot(path=str(shots / "phone-3-lists.png"))
    pg.click(".sheet-item:has-text('Home Projects')")
    check("lists sheet opens a list", pg.inner_text("#view-title") == "Home Projects")

    # ---- iPad size
    pad = b.new_page(viewport={"width": 1180, "height": 820}, device_scale_factor=2, has_touch=True)
    pad.on("pageerror", lambda e: errors.append(str(e)))
    pad.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pad.goto(base + "?demo=1")
    pad.wait_for_selector(".row")
    check("iPad shows sidebar, hides tabs", pad.is_visible("#sidebar") and not pad.is_visible("#tabs"))
    pad.click(".nav-item:has-text('Today')")
    pad.locator(".row", has_text="Weekly team sync").click()
    pad.wait_for_selector(".d-title")
    check("iPad details open beside the list", pad.is_visible("#detail") and pad.is_visible("#list"))
    pad.screenshot(path=str(shots / "ipad-1-today-detail.png"))

    check("no JavaScript or CSP errors", not errors, "; ".join(errors[:3]))
    b.close()

print(f"{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
