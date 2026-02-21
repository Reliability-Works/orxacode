# OrxaCode

Electron desktop app for monitoring and operating a local OpenCode server with a CodexMonitor-inspired UI.

## Features in this build

- Local runtime profiles (attach to running server or start `opencode serve` from app)
- Multi-project switcher
- Session list, message stream view, and prompt composer
- Model/agent/variant selection from OpenCode discovery APIs
- Permission and question action panel
- Config management:
  - Guided editor (`model`, `small_model`, `default_agent`, `plugin`)
  - Raw JSON/JSONC editor for project/global config files
  - Dedicated `~/.config/opencode/orxa/orxa.json` editor in settings
- Integrated terminal panel under composer powered by OpenCode PTY APIs
- Built-in Orxa plugin setup:
  - Non-destructive scaffold of `~/.config/opencode/orxa/*`
  - Automatic registration of `@reliabilityworks/opencode-orxa` in global OpenCode config
  - Automatic best-effort plugin installation (`bun` → `pnpm` → `npm`)

## Development

```bash
pnpm install
pnpm dev
```

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Packaging

```bash
pnpm dist
```

Targets configured: macOS (`dmg`) and Linux (`AppImage`).
