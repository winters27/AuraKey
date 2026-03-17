---
description: How to verify and test UI changes in a Tauri v2 application
---

# Tauri UI Verification

## Critical: No Localhost Access

Tauri v2 apps serve frontend assets via a **custom protocol** (`tauri://`), not `http://localhost`. The Vite dev server runs internally for HMR but is **not accessible** via a browser at `localhost:1420` or any other port.

**DO NOT** attempt to:
- Open `localhost:1420` (or any localhost port) in the browser subagent
- Use `read_browser_page` or `browser_subagent` to navigate to localhost
- Screenshot via browser tools — it will always fail with a connection error

## How to Verify Instead

1. **Trust the compiler** — If `npm run tauri dev` is running without errors, the frontend is rendering.
2. **Ask the user** — Request the user to visually confirm changes in the Tauri window.
3. **Check terminal output** — Use `read_terminal` on the running `npm run tauri dev` process to check for compilation errors or warnings.
4. **Build check** — Run `npm run build` (frontend only) to verify TypeScript and Vite compilation succeed.
