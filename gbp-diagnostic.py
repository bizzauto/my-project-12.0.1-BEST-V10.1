"""
GBP Diagnostic Script - runs LOCALLY on your machine.
Captures the exact Google Business Profile connect error.

HOW TO USE:
1. Edit the CONFIG section below with your credentials.
2. Run: python3 gbp-diagnostic.py
3. It will print console errors + final URL + page text.

No data leaves your machine except the normal Google login traffic.
"""

# ============ CONFIG - FILL THESE ============
GMAIL_EMAIL = "info.ledbrighter@gmail.com"
GMAIL_PASSWORD = "PASTE_YOUR_GMAIL_PASSWORD_HERE"   # <-- edit this
SITE_URL = "https://bizzautoai.com"
# =============================================

import sys
from playwright.sync_api import sync_playwright

def log(*a):
    print(*a, flush=True)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # visible so you can solve CAPTCHA if asked
        context = browser.new_context()
        page = context.new_page()

        console_errors = []
        page.on("console", lambda m: console_errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console_errors.append(f"[pageerror] {e}"))

        log("=== Opening site ===")
        page.goto(SITE_URL, wait_until="networkidle")
        page.wait_for_timeout(2000)

        # Click "Sign in with Google" if present on login page
        log("=== Looking for Google Sign-In button ===")
        try:
            # The login page has an iframe with Google button
            page.wait_for_selector("iframe", timeout=10000)
            btn = page.frame_locator("iframe").get_by_role("button", name="Sign in with Google")
            btn.click()
            log("Clicked Google Sign-In")
        except Exception as e:
            log(f"Google button not found automatically: {e}")
            log("Please log in manually in the browser window, then press Enter here.")
            input()

        # Handle Google account chooser / login
        page.wait_for_timeout(3000)
        try:
            if page.url.contains("accounts.google.com"):
                log("On Google login page. Filling credentials...")
                page.fill('input[type="email"]', GMAIL_EMAIL)
                page.click('button:has-text("Next")')
                page.wait_for_timeout(2000)
                page.fill('input[type="password"]', GMAIL_PASSWORD)
                page.click('button:has-text("Next")')
                page.wait_for_timeout(4000)
        except Exception as e:
            log(f"Auto-login step skipped/failed: {e}")

        log("=== Waiting for site dashboard ===")
        page.wait_for_timeout(5000)
        log(f"Current URL: {page.url}")

        # Go to GBP page
        log("=== Navigating to /google-business ===")
        page.goto(f"{SITE_URL}/google-business", wait_until="networkidle")
        page.wait_for_timeout(3000)

        # Click Connect button
        log("=== Clicking Connect button ===")
        try:
            connect_btn = page.get_by_role("button", name="Connect")
            connect_btn.first.click()
            log("Clicked Connect")
        except Exception as e:
            log(f"Connect button not found: {e}. Looking for any 'Connect Google' button...")
            try:
                page.get_by_text("Connect Google", exact=False).first.click()
            except Exception as e2:
                log(f"Could not click connect: {e2}")

        # Wait for OAuth popup / redirect
        page.wait_for_timeout(6000)

        # Handle Google OAuth consent if it appears
        if page.url.contains("accounts.google.com"):
            log("=== Google OAuth consent screen appeared ===")
            try:
                # Click Allow / Continue
                page.get_by_role("button", name="Allow").click(timeout=5000)
            except:
                try:
                    page.get_by_text("Allow", exact=True).click(timeout=5000)
                except:
                    log("Please click Allow manually in the browser, then press Enter.")
                    input()
            page.wait_for_timeout(6000)

        # Capture final state
        log("\n" + "="*50)
        log("FINAL URL:", page.url)
        log("="*50)
        log("\n=== CONSOLE ERRORS/WARNINGS ===")
        for e in console_errors[-30:]:
            log(e)
        log("\n=== PAGE TEXT (first 1500 chars) ===")
        try:
            txt = page.inner_text("body")
            log(txt[:1500])
        except:
            log("(could not extract body text)")
        log("\n=== DONE ===")

        browser.close()

if __name__ == "__main__":
    main()
