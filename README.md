# OrxaCode

OrxaCode is an Electron desktop app for operating OpenCode workspaces with a local-first, multi-project interface.

Powered by OpenCode and the `@opencode-ai/sdk` ecosystem.
Homage: [OpenCode on GitHub](https://github.com/sst/opencode).

## What It Includes

- Runtime profile management (attach to existing server or start local runtime)
- Multi-workspace switcher with dashboards
- Session/message workflow with prompt composer
- Permission/question handling for agent actions
- Terminal integration (OpenCode PTY APIs)
- Config editing:
  - guided settings for common fields
  - raw JSON/JSONC editor for project and global config
  - dedicated Orxa config editor
- Built-in Orxa plugin bootstrap/registration
- Auto-update checks for packaged builds via GitHub Releases

## Local Development

```bash
pnpm install
pnpm dev
```

Mac dev icon sync variant:

```bash
pnpm dev:mac
```

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
```

Coverage gate is enforced in CI for core shared logic (80% statements/functions/lines, 75% branches).

## Packaging

```bash
pnpm dist
```

Configured targets:

- macOS: `dmg`, `zip`
- Linux: `AppImage`

## Auto Updates

Packaged builds check GitHub Releases periodically and prompt users when an update is available.

- Prompt 1: download update now or later
- Prompt 2: restart now to apply downloaded update or later

Notes:

- Auto-update runs only in packaged builds (`app.isPackaged`)
- For private releases, provide a token with repo read access via environment (`GH_TOKEN`)

## GitHub Workflows

- `CI` workflow (`.github/workflows/ci.yml`):
  - runs on PRs and pushes to `main`
  - lint + typecheck + test coverage
- `Release` workflow (`.github/workflows/release.yml`):
  - runs on pushed tags matching `v*`
  - builds and publishes Electron artifacts to GitHub Releases

## Release Process

1. Bump `package.json` version.
2. Commit and push.
3. Create and push a version tag, for example:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Wait for the `Release` workflow to publish artifacts.
5. Users on installed packaged builds get update prompts on the next check cycle.

## Notes

- This repository customizes UX, workflows, and operational defaults for OrxaCode.
- It is not the upstream OpenCode project; see the upstream repo link above.
