# Providers and Threads

Orxa Code currently starts threads with three providers:

- Claude
- Codex
- Opencode

The new-session picker shows those as the active provider cards. Cursor is visible as unavailable, and Gemini is marked as coming soon.

## Thread model

A thread belongs to a project and starts with a chosen provider. The provider affects the runtime behind the thread, but the workspace around it stays the same:

- shared chat timeline
- browser, files, and git sidebars
- thread-scoped terminal drawer
- settings-driven model selection and traits

## Provider notes

### Claude

Claude threads run through the local Claude Agent SDK and CLI integration.

### Codex

Codex threads run through the Codex app-server JSON-RPC flow.

### Opencode

Opencode threads use your local authenticated Opencode setup.

## Handoff

Threads can be handed off between providers when you want to continue the same work with a different runtime. Handoff is part of the chat workspace itself, not a separate session type.

## What changed from the older docs

The old docs treated the app like it had a larger session matrix with separate Claude terminal modes and canvas-style workspace types. That is no longer the right mental model for the current product surface, so this doc stays focused on the provider-backed thread workflow that the app actually exposes today.
