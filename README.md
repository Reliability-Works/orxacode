# Orxa Code

A universal AI coding desktop app. Use OpenCode, Codex, or Claude Code — or all three — in one workspace.

![Orxa Code](assets/readme/session.png)

## Download

Get the latest release from the [Releases page](https://github.com/Reliability-Works/orxa-code/releases).

Available for **macOS** (dmg, zip), **Windows** (nsis, zip), and **Linux** (AppImage).

## Requirements

You need **at least one** of the following AI backends installed:

| Backend | Install | What it does |
|---------|---------|-------------|
| [OpenCode](https://github.com/anomalyco/opencode) | `npm install -g opencode-ai` | Full agent sessions with tool use, file editing, terminal, memory |
| [Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` | Agent sessions with plan mode, collaboration modes, subagents |
| [Claude Code](https://github.com/anthropics/claude-code) | `npm install -g @anthropic-ai/claude-code` | Terminal-based Claude sessions with permission controls |

On startup, the app checks which backends are available and enables session types accordingly.

## Features

- **Multi-provider** — switch between OpenCode, Codex, and Claude Code sessions from the sidebar
- **Unified chat UI** — all providers render through the same message components with tool cards, diffs, command output, and streaming indicators
- **Dock system** — plan progress, agent questions, permission requests, and message queue appear above the composer
- **Message queue** — type while the agent is busy; messages queue and send when the agent finishes
- **Plan mode** (Codex) — agents propose plans for review before implementing; accept, modify, or reject
- **Subagent support** (Codex) — collaboration modes and multi-agent delegation
- **Multi-tab terminal** (Claude) — split view, permission gating, live output
- **Canvas mode** — tiled workspace with terminal, browser, file editor, and markdown tiles
- **Integrated browser** — multi-tab Chromium with agent automation and persistent profile
- **Memory system** — local-first memory graph with workspace-scoped retrieval
- **Git integration** — diff viewer, commit flow, branch management in the right sidebar
- **Usage dashboards** — per-provider stats (tokens, cost, models)
- **Desktop notifications** — configurable alerts for agent waiting and task completion
- **Auto-updates** — stable and prerelease channels via GitHub Releases

## Documentation

Detailed docs are in the [`docs/`](docs/) directory:

- [Architecture](docs/architecture.md) — process model, IPC, event flow
- [Session types](docs/sessions.md) — OpenCode, Codex, Claude, Canvas explained
- [Chat UI](docs/chat-ui.md) — message components, docks, message queue
- [Browser integration](docs/browser.md) — agent automation, control handoff
- [Memory system](docs/memory.md) — storage, retrieval, graph visualization
- [Settings](docs/settings.md) — per-provider configuration reference
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

## Development

```bash
pnpm install
pnpm dev
```

```bash
pnpm lint        # eslint
pnpm typecheck   # tsc -b
pnpm test        # vitest
pnpm dist        # package for distribution
```

See [contributor.md](contributor.md) for contribution guidelines.

## License

[MIT](LICENSE)
