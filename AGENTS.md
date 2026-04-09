# AGENTS.md

## Purpose

This repository is the Orxa Code monorepo. It contains:

- the Electron desktop shell
- the React renderer
- the shared contracts layer
- the backend server and provider orchestration

## Upstream references

Orxa Code is not a straight downstream mirror of one upstream project.

When you need provider-specific behavior, treat the relevant upstream SDK, CLI, or protocol docs as canonical for that provider. Start with [docs/upstream-references.md](docs/upstream-references.md).

## Current product shape

The current app surface is centered on provider-backed threads and the tools around them:

- Claude
- Codex
- Opencode
- browser sidebar
- files sidebar
- git sidebar
- thread terminal drawer
- dashboard, skills, plugins, and settings routes

## Architecture routing map

When UI labels and backend behavior appear to disagree, follow this chain:

1. `apps/web/src/` for renderer behavior
2. `packages/contracts/src/ipc.ts` for desktop bridge payloads
3. `apps/desktop/src/main.ts` and `apps/desktop/src/preload.ts` for IPC wiring
4. `apps/server/src/` for runtime orchestration
5. provider upstream references from `docs/upstream-references.md`

## Alignment rules

- Treat upstream provider schemas and protocols as canonical for provider semantics.
- Do not invent UI-only interpretations when backend behavior already exists.
- Keep naming mismatches explicit at the boundary layer.
- Keep changes small and cohesive unless the task explicitly calls for a broader refactor.

## Validation

After non-doc changes:

1. Run targeted tests for touched areas.
2. Run `pnpm typecheck`.
3. Run `pnpm lint` and report warnings or errors.

For docs-only changes, skip those checks unless the docs describe behavior you had to verify in code.

## Performance sync guardrails

- High-frequency sync paths such as resume handlers, polling loops, and background refreshes must use single-flight dedupe plus coalescing or debounce.
- Do not call full-bootstrap project endpoints from polling or resume loops when a lighter read path exists.
- Prefer event-driven updates. If polling is required, keep it conservative and reconcile once on mount or resume.
- For large IPC responses, capture telemetry for request volume, inflight concurrency, and payload size.
- Performance exports should default to slow, high-signal filtering instead of raw full dumps.

## Hierarchical guidance

- There are no nested `AGENTS.md` files under `apps/` or `packages/` right now.
- Use this file with the local source structure and the docs in `docs/`.
