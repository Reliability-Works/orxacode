# Orxa Code Exploration

## What I explored

The repo root structure:

- **Monorepo** using pnpm workspace
- `apps/`: `desktop` (Electron shell), `server` (backend runtime), `web` (renderer UI)
- `packages/`: `contracts` (IPC/shared types), `shared` (common utilities)
- Standard tooling: TypeScript, ESLint, Vitest, Playwright, electron-builder

## What I read

1. **`/Users/callumspencer/Repos/macapp/orxacode/README.md`** — Project overview describing Orxa Code as a desktop app for working with AI coding agents (OpenCode, Codex, Claude Code). Documents features: multi-provider chat, integrated browser with annotations, canvas workspace, themes, Git sidebar, Jobs, Skills discovery.

2. **`/Users/callumspencer/Repos/macapp/orxacode/apps/web/src/components/chat/useChatSendAction.ts`** — Core chat send action hook (~236 lines) with provider-agnostic message routing. Key features: plan follow-up handling, slash command parsing, terminal context integration, message queuing when turn is running, pre-send validation.

3. **`/Users/callumspencer/Repos/macapp/orxacode/apps/web/src/components/skills/SkillsView.tsx`** — Skills/plugins discovery UI (~282 lines) with provider filtering (all/opencode/codex/claude), search functionality, React Query data fetching, and tabbed view switching between Skills and Plugins.

## What I think this repo does

**Orxa Code** is a desktop Electron app that provides a unified workspace for multiple AI coding agents. It follows a "bring your own backend" model:

- Supports **OpenCode**, **Codex**, and **Claude Code** as backend providers
- Provides a **shared chat UI** across providers (tool cards, diffs, streaming, plan mode)
- Includes an **integrated browser** with agent automation and element annotations
- Has a **canvas workspace** for arranging terminals, browsers, editors
- Features a **skills/plugins discovery system** for browsing provider capabilities
- Uses IPC contracts (`packages/contracts`) to bridge desktop main process, web renderer, and server runtime

The architecture cleanly separates: desktop shell (main/preload), web renderer (React UI), and server runtime (backend orchestration).

## One concrete follow-up idea

Add a **global keyboard shortcut (e.g., Cmd/Ctrl+Shift+T)** that opens a "Quick Thread Switcher" — a fuzzy-search palette showing recent threads across all providers. This would reduce sidebar navigation friction when users work with multiple agents simultaneously. The data already exists (`useActiveThreadId` in SkillsView shows thread tracking), it just needs a searchable overlay component and a global shortcut handler in the desktop layer.
