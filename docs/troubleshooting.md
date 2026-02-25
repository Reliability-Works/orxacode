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
