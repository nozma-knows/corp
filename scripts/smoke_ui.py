"""End-to-end checks on an isolated temporary company; leaves user data untouched.

Requires Playwright plus an installed Chromium browser. No external sites used.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:8001"
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def state():
    with urllib.request.urlopen(URL + "/api/state") as response:
        return json.load(response)


with tempfile.TemporaryDirectory() as directory:
    server = subprocess.Popen([sys.executable, "-m", "corp", "--port", "8001", "--database", str(Path(directory) / "smoke.sqlite3")], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for attempt in range(40):
            if server.poll() is not None:
                raise RuntimeError("The isolated UI test server exited before startup.")
            try:
                state()
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("The isolated UI test server did not start.")

        with sync_playwright() as playwright:
            options = {"headless": True, "args": ["--no-sandbox"]}
            executable = os.environ.get("CORP_CHROMIUM_PATH")
            if executable or Path("/usr/bin/chromium").exists():
                options["executable_path"] = executable or "/usr/bin/chromium"
            browser = playwright.chromium.launch(**options)
            page = browser.new_page(viewport={"width": 1440, "height": 1050})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(URL, wait_until="networkidle")
            expect(page.get_by_role("heading", name="Your company, at a glance.")).to_be_visible()
            page.get_by_role("button", name="Run a cycle", exact=True).click()
            expect(page.locator(".metric").filter(has_text="Operating profit").locator(".metric-value")).to_have_text("$19.50")
            assert state()["company"]["cash_minor"] == 101950
            page.screenshot(path=str(ARTIFACTS / "dashboard-after-cycle.png"), full_page=True)

            page.get_by_role("link", name="Treasury", exact=True).click()
            page.get_by_role("button", name="New experiment").click()
            page.get_by_label("Experiment name").fill("Test two listing designs")
            page.get_by_label("Maximum cost (USD)").fill("12")
            page.get_by_role("button", name="Reserve funds", exact=True).click()
            expect(page.get_by_text("Test two listing designs", exact=True)).to_be_visible()
            assert state()["company"]["reserved_minor"] == 1200
            page.get_by_role("button", name="Pause company", exact=True).click()
            expect(page.get_by_role("button", name="Execute", exact=True)).to_be_disabled()
            page.get_by_role("button", name="Cancel", exact=True).click()
            assert state()["company"]["reserved_minor"] == 0
            page.get_by_role("button", name="Refund", exact=True).click()
            page.get_by_role("button", name="Record full refund", exact=True).click()
            assert state()["company"]["cash_minor"] == 99550
            assert state()["company"]["profit_minor"] == -450
            page.get_by_role("button", name="Resume company", exact=True).click()

            page.get_by_role("link", name="Controls", exact=True).click()
            page.get_by_role("button", name="Edit limits").click()
            page.get_by_label("Per-action ceiling (USD)").fill("1")
            page.get_by_role("button", name="Save limits", exact=True).click()
            page.get_by_role("button", name="Run a cycle", exact=True).click()
            expect(page.locator("#toast")).to_contain_text("per-action spending limit")
            assert state()["company"]["order_count"] == 1
            page.get_by_role("button", name="Edit limits").click()
            page.get_by_label("Per-action ceiling (USD)").fill("25")
            page.get_by_role("button", name="Save limits", exact=True).click()

            for target in ("Overview", "Agent team", "Businesses", "Treasury", "Activity", "Controls"):
                page.get_by_role("link", name=target, exact=True).click()
                expect(page.locator("#main h1")).to_be_visible()

            page.get_by_role("link", name="Overview", exact=True).click()
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(ARTIFACTS / "dashboard-mobile.png"), full_page=True)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile page overflows horizontally"
            page.set_viewport_size({"width": 1440, "height": 1080})
            page.evaluate("document.documentElement.style.fontSize = '32px'")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "200% text layout overflows horizontally"
            assert not errors, errors
            browser.close()
        print("UI verified: cycle, reservation, pause, cancellation, refund, policy rejection, six views, mobile and 200% text. No browser errors.")
    finally:
        server.terminate()
        server.wait(timeout=10)
