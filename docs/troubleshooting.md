# Troubleshooting

## OpenCode runtime connection failures

**Symptoms**: Runtime status stuck on disconnected or error. Session operations fail.

1. Open Settings > Server and press Refresh Diagnostics
2. Verify profile host/port and credentials
3. If using local runtime, press Repair Runtime and retry
4. Restart the app to re-run bootstrap

## Codex connection issues

**Symptoms**: Codex sessions show "Connecting to Codex..." indefinitely or error.

1. Verify the Codex CLI is installed: `codex --version`
2. Check Settings > Codex > General for the binary path
3. Run `codex doctor` from terminal to check dependencies
4. The app searches common install paths (nvm, Homebrew, Volta) — if installed elsewhere, set the explicit path in settings
5. Check that no other process is already running `codex app-server`

## Claude Code not launching

**Symptoms**: Claude session shows blank terminal or "not available" message.

1. Verify Claude Code CLI is installed: `claude --version`
2. The CLI must be in your PATH — Electron may not inherit shell PATH on macOS
3. Try setting explicit path in settings if auto-detection fails
4. Check that `ANTHROPIC_API_KEY` is set or Claude is authenticated

## Browser not rendering

**Symptoms**: Browser pane appears blank or navigation doesn't work.

1. Switch to the Browser tab in the right sidebar and open a new tab
2. Resize the app window (refreshes browser bounds sync)
3. If still blank, restart the app to rebuild WebContentsView attachments

## Browser agent actions blocked

**Symptoms**: Browser results come back with blocked reason.

1. Enable Browser Mode in the composer controls
2. Ensure ownership is set to agent (Hand back to agent if human owns control)
3. For job runs, enable Browser Mode in the job editor

## Sessions disappearing from sidebar

Sessions without any messages are automatically cleaned up when you navigate away. This is by design. Send at least one message to persist a session.

## Desktop notifications not appearing

1. Check Settings > App for notification toggles
2. Notifications only fire when the app window is not focused
3. macOS: ensure Orxa Code has notification permission in System Settings > Notifications

## Update checks not running

1. Ensure this is a packaged build (dev mode skips updates)
2. Enable auto-check in Settings > App
3. Verify release channel (stable vs prerelease) matches published tags
