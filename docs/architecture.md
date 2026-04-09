# Architecture

Orxa Code is split into four main layers:

```text
Renderer (React UI)
  -> Desktop bridge (preload + IPC)
  -> Main process (Electron shell and native integrations)
  -> Server process (providers, git, terminals, persistence)
  -> Shared contracts (typed IPC and RPC payloads)
```

## Main pieces

### Renderer

`apps/web/src/` holds the app UI. That includes:

- the chat workspace
- the browser, files, and git sidebars
- dashboard, skills, plugins, and settings routes

The renderer never talks to Node APIs directly. It goes through typed contracts.

### Desktop bridge

`apps/desktop/src/preload.ts` exposes the safe API that the renderer uses for desktop-only features such as browser runtime actions, theme sync, dialogs, and update controls.

### Main process

`apps/desktop/src/` owns:

- the Electron window lifecycle
- native menus and dialogs
- the embedded browser runtime
- desktop update wiring
- IPC handlers that forward work to the renderer-safe bridge or the server

### Server process

`apps/server/src/` owns most of the application logic:

- provider orchestration for Claude, Codex, and Opencode
- thread persistence and projections
- git data and thread handoff support
- thread-scoped terminals
- skills and plugin discovery

### Shared contracts

`packages/contracts/src/` defines the payloads and event shapes shared between the renderer, desktop process, and server.

## Data flow

Most UI work follows the same path:

1. The renderer sends a typed request.
2. The request goes through preload and IPC or through the server RPC layer.
3. The main or server process does the work.
4. Events come back as normalized updates that the renderer can project into thread state.

That is why different providers can share the same chat timeline, approvals, and sidebars even though their runtimes are different underneath.

## Provider routing

Current provider entry points are:

- Claude
- Codex
- Opencode

The new-session picker reflects the same set. If a provider is not ready locally, the card stays disabled instead of pretending the feature is available.

## Files to start with

- `apps/web/src/components/chat/`
- `apps/web/src/components/browser-sidebar/`
- `apps/web/src/components/files-sidebar/`
- `apps/web/src/components/git-sidebar/`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- `apps/server/src/`
- `packages/contracts/src/`
