# Contributor Guide

Thanks for contributing to Orxa Code.

## Scope

Orxa Code is an Electron desktop frontend for OpenCode.  
When behavior differs between UI labels and backend behavior, align to upstream OpenCode semantics:

- Upstream reference: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Renderer: `src/`
- IPC contract: `shared/ipc.ts`
- Main process handlers: `electron/main.ts`
- Runtime bridge/service: `electron/services/opencode-service.ts`

## Local Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start dev mode:
   ```bash
   pnpm dev
   ```
3. Optional mac icon sync variant:
   ```bash
   pnpm dev:mac
   ```

## Before Opening a PR

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Prefer small, focused PRs that solve one issue cleanly.

## Coding Expectations

- Keep changes cohesive and minimal.
- Reuse existing components/hooks/services before adding new abstractions.
- Remove dead code introduced by refactors.
- Preserve established UI language and interaction patterns unless redesign is intentional.
- For backend-facing changes, keep naming/shape alignment with upstream SDK/server contracts.

## UI and UX Expectations

- Keep status and activity messages actionable and specific.
- Avoid noisy timeline events with low signal.
- Ensure modal interactions are keyboard-safe (including `Esc`) and visually stable across pane sizes.
- Verify scroll behavior and overlap behavior around bottom drawers/panels.

## Testing Guidance

- Add or update regression tests for behavioral fixes.
- Prefer tests near the changed unit:
  - `src/components/*.test.tsx` for renderer behavior
  - `src/hooks/*.test.tsx` for hook logic
  - `electron/services/*.test.ts` for service/bridge behavior
- If tests are intentionally skipped, explain why in the PR.

## Documentation

Update docs when behavior or setup changes:

- `README.md` for user-facing app behavior and setup
- `docs/architecture.md` for architecture-level changes
- `docs/troubleshooting.md` for user-facing diagnostics

