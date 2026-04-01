# AGENTS.md (src/)

## Scope

Renderer UI and client-side behavior.

## Responsibility

- Render backend/session state accurately without inventing alternate semantics.
- Keep UX-friendly labels while preserving traceability to backend route names.

## Renderer Rules

- Treat SDK/IPC payloads as source data, not suggestions.
- If frontend wording differs from backend tool/part names, keep the mapping explicit in code near the boundary.
- Keep timeline/activity views compact but lossless for important events.
- Do not hardcode assumptions about tool states or part variants outside typed schemas.

## Integration Path

Renderer requests should flow through:

1. `src/lib/services/opencodeClient.ts`
2. `window.orxa.opencode` preload bridge
3. IPC handlers in main process

## Upstream Reference

- [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
