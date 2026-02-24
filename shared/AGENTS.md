# AGENTS.md (shared/)

## Scope
Cross-process contracts and shared frontend/backend types.

## Responsibility
- `shared/ipc.ts` is the canonical contract used by renderer, preload, and main process.

## Contract Rules
- Changes here are breaking unless all consumers are updated in the same change:
1. `electron/preload.ts`
2. `electron/main.ts`
3. Renderer callers (for example `src/lib/services/opencodeClient.ts`)
- Keep naming explicit and stable.
- Prefer additive changes over incompatible renames/removals unless explicitly requested.

## Upstream Alignment
- Match Opencode SDK/server semantics for session/message/tool payloads.
- Reference upstream source first when uncertainty exists:
  - [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
