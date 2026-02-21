# Overrides Directory

This folder is for **customizing built-in agents**. Files placed here take precedence over the cached versions in `agents/subagents/`.

## How Overrides Work

When Orxa loads an agent, it checks for overrides in this order:
1. **`agents/overrides/`** - Your customizations (highest priority)
2. **`agents/subagents/`** - Cached built-in agents (lowest priority)

If a file exists in `overrides/`, it completely replaces the cached version.

## What Can Be Overridden?

### Primary Agents (orxa, plan)

For primary agents, **only the `model` field** is used from override files. Other fields are ignored because the system prompt and behavior are controlled by the plugin.

Example - Override just the model:
```yaml
---
model: opencode/gpt-5.3-codex
---
```

### Subagents (coder, build, frontend, etc.)

For subagents, **any field can be overridden**:
- `model` - Change the AI model
- `temperature` - Adjust creativity (0.0 - 1.0)
- `tools` - Modify available tools
- System prompt content - Customize behavior

## Example: Overriding a Subagent

Create `agents/overrides/coder.yaml`:

```yaml
---
description: Customized coder agent with stricter typing rules
mode: subagent
model: opencode/gpt-5.3-codex
temperature: 0.1
tools:
  - read
  - edit
  - write
  - bash
  - grep
  - glob
---

You are a specialized coder with strict TypeScript requirements.

## Additional Rules
- Always use explicit return types
- Never use `any` type
- Prefer `const` over `let`
- Use strict equality (`===` not `==`)
```

## Getting Started

1. Copy an agent from `agents/subagents/` to this directory
2. Modify the fields you want to change
3. Save the file - changes take effect immediately

## See Also

- [`agents/subagents/README.md`](../subagents/README.md) - About cached built-in agents
- [`agents/custom/README.md`](../custom/README.md) - Creating completely new agents
