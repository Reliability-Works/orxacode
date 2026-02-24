# AGENTS.md (electron/)

## Scope
Main-process and backend bridge logic.

## Responsibility
- Own the route from renderer IPC requests to Opencode server calls.
- Keep handler behavior aligned with upstream Opencode semantics.

## Routing Contract
For every backend-facing feature, keep this mapping coherent:
1. `shared/ipc.ts` constant/type
2. `electron/main.ts` `ipcMain.handle(...)`
3. `electron/services/opencode-service.ts` method
4. Opencode SDK call (`@opencode-ai/sdk`) and upstream server behavior

## Change Rules
- Do not add or change an IPC route in only one place.
- If payload shape changes, update validation in `electron/main.ts` and service method types.
- Prefer explicit mapping logic over implicit assumptions.
- Preserve tool/message state semantics from upstream (`pending`, `running`, `completed`, `error`).

## Upstream Reference
- [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
