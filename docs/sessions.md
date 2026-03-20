# Session Types

Orxa Code supports four session types, created from the `+` button in the sidebar.

## OpenCode

Full agent sessions powered by the OpenCode SDK and runtime server.

- Rich tool use: file editing, bash execution, web search, code search
- Structured message feed with tool cards, diffs, and command output
- Agent/model selection with variant support
- Memory integration for workspace-scoped context
- Permission mode switching mid-session (ask-write / yolo)
- Plan mode toggle for planning-first workflows
- Browser automation when browser mode is enabled

**Requires**: OpenCode CLI installed (`npm install -g opencode-ai`)

## Codex

Agent sessions via the Codex CLI app-server using JSON-RPC over stdio.

- Full agent execution — file editing, command execution, web search, and more
- Plan mode with proposal/approval flow before implementation
- Collaboration modes for multi-agent workflows
- Subagent delegation with live output tracking
- Model selector with reasoning effort control
- Rich item types: command output, file diffs, reasoning blocks, context tools
- Live streaming deltas for all operations
- Thread name auto-updates from the app-server

**Requires**: Codex CLI installed (`npm install -g @openai/codex`)

## Claude Code

Terminal-based Claude sessions running the Claude Code CLI in a PTY.

- Multi-tab terminal support (create multiple Claude instances)
- Split view layout (horizontal or vertical)
- Permission mode selection: Standard (ask before acting) or Full Access
- Remembers permission choice per workspace
- Session persistence across navigation
- Live terminal output streaming

**Requires**: Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)

## Canvas

Tiled workspace for non-linear, multi-tool workflows.

- Drag-and-drop tile arrangement
- Tile types: terminal, browser, file editor, markdown, API tester, dev server, image
- Theme customization per canvas
- Snap-to-grid layout
- Persistent tile arrangement per session
