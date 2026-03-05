# Troubleshooting

## Runtime connection failures

Symptoms:
- Runtime status stuck on `disconnected` or `error`.
- Session operations fail immediately.

Checks:
1. Open Settings -> Server and press `Refresh Diagnostics`.
2. Verify profile host/port and credentials.
3. If using local runtime, press `Repair Runtime` and retry.
4. Restart the app to re-run bootstrap and profile attach.

## Plugin bootstrap failures (Orxa mode)

Symptoms:
- Orxa mode selected but plugin features do not appear.
- Errors while reading/writing Orxa config.

Checks:
1. Ensure app mode is `Orxa` in Settings -> App.
2. In Settings -> Server, confirm plugin is both configured and installed.
3. Use `Repair Runtime` to re-apply registration.
4. Check terminal logs for plugin install errors.

## Update checks not running

Symptoms:
- No update prompts in packaged builds.

Checks:
1. Ensure this is a packaged app build (dev mode intentionally skips updater checks).
2. In Settings -> App, enable `Automatically check for updates`.
3. Use `Check for updates now` for a manual check.
4. Verify release channel (`stable` vs `prerelease`) matches the published tag type.

## Release smoke-test failures

Symptoms:
- `smoke-test` workflow fails while launching artifact.

Checks:
1. Verify unpacked artifact was built (`electron-builder --dir`).
2. Ensure binary exists under expected `dist/*-unpacked` path.
3. Confirm app accepts `--smoke-test` and exits cleanly.

## Integrated browser not rendering or not interactive

Symptoms:
- Browser pane appears blank.
- Navigation controls do not update tab state.
- Agent browser actions run but visible browser does not follow.

Checks:
1. Switch to the `Browser` right-sidebar tab and open a new tab to force attach.
2. Resize the app window once (this refreshes browser bounds sync).
3. Confirm Browser Mode is enabled when expecting agent-driven browser actions.
4. If still blank, restart app to rebuild `WebContentsView` attachments.

## Browser credentials/session not persisting

Symptoms:
- Sites log out after app restart.

Checks:
1. Verify navigation uses normal `https://` pages (non-HTTP(S) schemes are blocked).
2. Confirm you are using the in-app browser pane (not external fallback flows).
3. Ensure app has write access to its user data directory.
4. If storage was cleared manually, sign in again to repopulate persistent browser partition data.

## Agent browser actions blocked unexpectedly

Symptoms:
- Browser results come back with blocked reason.

Checks:
1. In composer controls, enable Browser Mode.
2. In browser strip controls, ensure ownership is set to agent (`Hand back to agent` if human currently owns control).
3. For Jobs runs, open Job editor and enable `Enable Browser Mode` for that specific job.
4. Confirm assistant output uses `<orxa_browser_action>{...}</orxa_browser_action>` with `id`, `action`, and `args`.

## Browser DOM actions fail on dynamic/anti-automation pages

Symptoms:
- `click`, `type`, or `extract_text` fails intermittently.
- Action returns selector or visibility errors on modern SPA/virtualized pages.

Checks:
1. Use richer locators instead of a single CSS selector:
   - `selectors` fallback array
   - `text`, `role` + `name`, or `label`
   - `frameSelector` when content is inside an iframe
2. Increase `timeoutMs` and `maxAttempts` for delayed rendering.
3. Use `wait_for`, `wait_for_navigation`, and `wait_for_idle` before fragile interactions.
4. Add retry logic at workflow level and handle deterministic blocked/timeouts.
