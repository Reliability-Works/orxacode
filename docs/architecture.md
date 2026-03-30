# Architecture

Orxa Code is an Electron app with strict process separation between main, preload, and renderer. It orchestrates OpenCode, Codex, Claude Code, and browser services behind a unified desktop shell.

```
User
  |
  v
Renderer (React/Vite)
  |  window.orxa bridge
  v
Preload (contextBridge + IPC facade)
  |  ipcRenderer.invoke / subscribe
  v
Main Process (Electron)
  |
  +---> OpencodeService -----> OpenCode runtime/server
  +---> CodexService ---------> Codex CLI app-server (JSON-RPC over stdio)
  +---> ClaudeChatService ----> Claude Code SDK + Claude Code CLI
  +---> Claude Terminal ------> Claude Code CLI (PTY)
  +---> BrowserController ----> Embedded Chromium (WebContentsView)
  +---> UsageStatsService ----> ~/.claude JSONL + codex usage cache
  +---> AutoUpdater ----------> GitHub Releases
  +---> Stores ---------------> Electron local storage
```

## Process Boundaries

- `electron/main.ts` — BrowserWindow lifecycle, IPC handlers, service orchestration
- `electron/preload.ts` — typed API surface exposed as `window.orxa`
- `electron/services/opencode-service.ts` — OpenCode SDK bridge
- `electron/services/codex-service.ts` — Codex app-server JSON-RPC client
- `electron/services/claude-chat-service.ts` — Claude Code structured chat bridge
- `electron/services/usage-stats-service.ts` — Usage data readers for Claude and Codex
- `electron/services/browser-controller.ts` — In-app browser (tabs, bounds, history, agent actions)
- `src/*` — React UI, no direct Node APIs

## IPC Contract

Defined in `shared/ipc.ts`:

- All renderer-main communication goes through typed channels
- High-risk inputs are validated in main
- Browser automation IPC is sender-validated and payload-validated per action

## Event Flow

All three providers emit events through a unified `orxa:events` IPC channel:

- **OpenCode**: SDK server events (message updates, permissions, questions, todos, session status)
- **Codex**: App-server notifications (item lifecycle, deltas, approvals, user input, plan updates, thread naming)
- **Claude Code (Chat)**: structured turn, permission, question, task, and subagent notifications
- **Claude Code (Terminal)**: terminal output and lifecycle events via PTY

The renderer subscribes once and routes events to the appropriate session hook.

## Provider Services

### OpenCode

- Full SDK client with session/message/tool APIs
- Real-time event streaming
- Permission and question request/reply flow
- Todo tracking from `todo.updated` events

### Codex

- Spawns `codex app-server` as child process
- JSON-RPC 2.0 over stdin/stdout (newline-delimited JSON)
- Initialize handshake, then model/list and collaborationMode/list
- Handles: approvals, user input requests, streaming deltas, plan updates, thread naming
- Module-level session persistence (survives component remounts)

### Claude Code (Chat)

- Uses the Claude Code SDK with the local `claude` executable
- Structured turn lifecycle with model options, permissions, and user-input requests
- Background-agent / task tracking from explicit Claude task and thread events
- Unified chat timeline projection in the renderer
- Background session manager keeps inactive Claude chat sessions alive for dock updates

### Claude Code (Terminal)

- PTY terminal via OpenCode terminal API with `exec` shell replacement
- Echo clearing: buffers output until CLI starts, then clears terminal
- Multi-tab and split view support
- Permission mode stored per workspace in localStorage
