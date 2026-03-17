# Contributor Guide

Thanks for contributing to Orxa Code.

## Scope

Orxa Code is an Electron desktop app that integrates three AI backends (OpenCode, Codex, Claude Code) into a unified workspace.

Key directories:

- `src/` — React renderer (UI components, hooks, styles)
- `src/components/chat/` — Shared chat UI components used by all providers
- `electron/` — Main process (IPC handlers, services)
- `electron/services/` — Backend service bridges (OpenCode, Codex, usage stats, browser)
- `shared/ipc.ts` — IPC channel definitions and shared types
- `src/types/app.ts` — App preferences and local types

## Local Setup

```bash
pnpm install
pnpm dev
```

Mac dev icon sync:

```bash
pnpm dev:mac
```

## Testing

```bash
pnpm test            # run all tests
pnpm test:coverage   # run with coverage report
pnpm lint            # eslint
pnpm typecheck       # tsc -b (strict)
```

All three must pass before committing (enforced by pre-commit hook).

## Guidelines

- All providers share the same chat components — don't create provider-specific UI unless the interaction is fundamentally different
- Use existing design tokens from `src/styles/base.css`
- New IPC channels must be defined in `shared/ipc.ts` with types
- Event flow: backend service → `electron/main.ts` publish → `orxa:events` channel → renderer subscription
- Test coverage thresholds are enforced in CI
