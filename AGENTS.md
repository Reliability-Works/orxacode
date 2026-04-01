# AGENTS.md

## Purpose

This repository is an Electron desktop frontend for Opencode.

## Canonical Upstream

- Source of truth: [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)

## Provider References

- Use [`docs/upstream-references.md`](docs/upstream-references.md) when aligning Orxa Code behavior with upstream provider SDKs, CLIs, or app-server protocols.
- Treat those upstream docs/repos as canonical for provider-specific semantics before introducing UI-only interpretations.

## Architecture Routing Map

When behavior appears different between frontend labels and backend routing, follow this chain:

1. `src/` (renderer UI behavior)
2. `shared/ipc.ts` (IPC contract + payload types)
3. `electron/main.ts` (IPC handlers)
4. `electron/services/opencode-service.ts` (bridge/service logic)
5. Opencode SDK/server behavior in upstream repo

## Alignment Rules

- Treat upstream SDK/server schemas as canonical for message parts, tool states, and session behavior.
- Do not reinterpret backend semantics in UI-only code without checking upstream first.
- If naming differs between UI and backend, preserve a clear mapping in code and comments near the boundary layer.
- Keep changes small and cohesive; avoid broad refactors unless requested.

## Validation

After non-doc changes:

1. Run targeted tests for touched areas.
2. Run `pnpm typecheck`.
3. Run `pnpm lint` and report warnings/errors.

## Performance Sync Guardrails

- High-frequency sync paths (resume handlers, polling loops, background refresh) must use **single-flight dedupe** and **coalescing/debounce**.
- Do not call full-bootstrap project endpoints from polling/resume loops when a lighter delta/read endpoint exists.
- Prefer event-driven updates; if polling is required, use one-shot reconcile on mount/resume and conservative cadence.
- For large IPC responses, capture telemetry for request volume, inflight concurrency, and payload size so queueing regressions are visible.
- Performance exports should default to slow/high-signal filtering (time window + min duration + surface allowlist) rather than raw full dumps.

## Hierarchical Guidance

- `electron/AGENTS.md` for IPC/main-process/service routing details.
- `shared/AGENTS.md` for IPC contract rules.
- `src/AGENTS.md` for renderer/UI interpretation rules.
