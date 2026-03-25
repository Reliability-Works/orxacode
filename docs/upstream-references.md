# Upstream References

Use these references when implementing or debugging provider-specific behavior in Orxa Code.

## OpenCode

- Runtime / upstream repo: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- SDK package used in this repo: [`@opencode-ai/sdk`](https://github.com/anomalyco/opencode)
- Local import path in this codebase: `@opencode-ai/sdk/v2/client`

Notes:
- Treat the upstream OpenCode repo and the generated SDK types as canonical for OpenCode session/runtime semantics.
- When UI labels differ from OpenCode naming, keep the mapping explicit near the IPC/service boundary.

## Codex

- CLI / upstream repo: [openai/codex](https://github.com/openai/codex)
- App-server protocol and lifecycle: [codex-rs/app-server/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- Collaboration mode templates:
  - [Default](https://github.com/openai/codex/blob/main/codex-rs/core/templates/collaboration_mode/default.md)
  - [Plan](https://github.com/openai/codex/blob/main/codex-rs/core/templates/collaboration_mode/plan.md)
  - [Execute](https://github.com/openai/codex/blob/main/codex-rs/core/templates/collaboration_mode/execute.md)

Notes:
- Treat the app-server README as canonical for JSON-RPC transport, turn lifecycle, collaboration modes, approvals, and `request_user_input`.
- Treat the collaboration mode templates as canonical for what “Plan”, “Default”, and “Execute” actually mean.

## Claude

- Agent SDK overview: [Anthropic Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview)
- SDK package used in this repo: `@anthropic-ai/claude-agent-sdk`
- Claude Code docs landing page: [Claude Code docs](https://code.claude.com/docs)

Notes:
- Use the Anthropic SDK/docs as canonical for Claude agent/session semantics.
- Keep Claude Code terminal/chat behavior aligned with the upstream SDK + CLI concepts instead of inventing Orxa-specific protocol meanings.
