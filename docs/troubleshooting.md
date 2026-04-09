# Troubleshooting

## A provider card is disabled

Open the new-session picker or the Providers settings page and check the provider status message first.

- Claude: confirm `claude --version` works in your shell
- Codex: confirm `codex --version` works in your shell
- Opencode: confirm your local Opencode install and authentication are healthy

If the CLI works in your shell but not in the app, re-check the provider settings and restart Orxa Code.

## The browser sidebar is blank

Try these in order:

1. Close and reopen the browser sidebar from the thread header.
2. Open a new browser tab.
3. Reload the current tab.
4. Restart the app if the embedded view still does not attach correctly.

## Inspect mode is not capturing annotations

- Make sure the browser sidebar is open for the active thread.
- Turn on `Inspect`.
- Click inside the page content, not the browser controls.
- If capture still fails, reload the page and try again.

## The files sidebar is empty

The files sidebar needs a project-backed thread. If you opened a thread without a usable project cwd, the sidebar will not have anything to browse.

## Git data is missing

The git sidebar only works when the active thread is attached to a git repository. Check the project cwd first, then confirm the repo is valid on disk.

## Update actions are unavailable

Update controls depend on a packaged desktop build. If you are running from `pnpm dev`, update checks and install actions will not behave like the release build.
