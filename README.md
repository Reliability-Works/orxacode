# Opencode Orxa

![Opencode Orxa hero banner](assets/readme/opencode-orxa-hero-banner-16x9.svg)

## UI Preview

Main session view:

![Main session view](assets/readme/session.png)

Subagent live output with unified diff:

![Subagent unified diff view](assets/readme/subagent-unified-diff.png)

Opencode Orxa is an Electron desktop app for operating OpenCode workspaces with a local-first, multi-project interface.

Powered by OpenCode and the `@opencode-ai/sdk` ecosystem.
Source of truth: [anomalyco/opencode](https://github.com/anomalyco/opencode).

## Runtime Requirements

### Required: OpenCode

- Repository: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Why required: Opencode Orxa depends on the OpenCode CLI/server runtime for sessions, tools, and streaming.
- Install command:

```bash
npm install -g opencode-ai
```

### Optional: Orxa Package (for Orxa mode)

- Repository: [Reliability-Works/opencode-orxa](https://github.com/Reliability-Works/opencode-orxa)
- Why optional: needed only for Orxa mode workflows, templates, and agent assets.
- Install command:

```bash
npm install -g @reliabilityworks/opencode-orxa
```

On startup, the app runs a dependency check and shows an install helper modal if either dependency is missing.

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
- Update controls in Settings and Help menu (`Check for updates`)

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

- macOS: `dmg`, `zip` (signed + notarized in CI)
- Windows: `nsis`, `zip`
- Linux: `AppImage`

## Auto Updates

Packaged builds check GitHub Releases periodically and prompt users when an update is available.

- Prompt 1: download update now or later
- Prompt 2: restart now to apply downloaded update or later

Notes:

- Auto-update runs only in packaged builds (`app.isPackaged`)
- For private releases, provide a token with repo read access via environment (`GH_TOKEN`)
- Users can choose update channel in Settings:
  - `stable`: only stable tags (e.g. `v1.2.3`)
  - `prerelease`: includes prerelease tags (e.g. `v1.2.3-beta.1`)

## GitHub Workflows

- `CI` workflow (`.github/workflows/ci.yml`):
  - runs on PRs and pushes to `main`
  - lint + typecheck + test coverage
- `Secret Scan` workflow (`.github/workflows/secret-scan.yml`):
  - runs on PRs and pushes to `main`
  - scans repository history for leaked secrets using Gitleaks
- `Release` workflow (`.github/workflows/release.yml`):
  - runs on pushed tags matching `v*`
  - runs artifact smoke tests on macOS/Linux/Windows
  - builds and publishes Electron artifacts to GitHub Releases
  - signs + notarizes macOS artifacts

### Required Secrets for Signed macOS Releases

- `MACOS_CERT_P12_BASE64`: base64-encoded `.p12` Developer ID Application certificate
- `MACOS_CERT_PASSWORD`: password for the `.p12` certificate
- `APPLE_ID`: Apple Developer account email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization
- `APPLE_TEAM_ID`: Apple team identifier

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

## Architecture + Troubleshooting

- Architecture diagram: [`docs/architecture.md`](docs/architecture.md)
- Troubleshooting guide: [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Notes

- This repository customizes UX, workflows, and operational defaults for Opencode Orxa.
- It is not the upstream OpenCode project; see the upstream repo link above.
