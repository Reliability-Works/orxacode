# Subagents Directory

This folder contains **cached built-in agents** that are managed automatically by the OpenCode Orxa plugin.

## ⚠️ Important: Do Not Edit Files Here

The files in this directory are **automatically updated** when the plugin is updated. Any manual changes you make will be **overwritten** during the next plugin update.

## How to Customize Built-in Agents

If you want to customize a built-in agent, use the **`agents/overrides/`** directory instead:

1. Copy the agent file from `agents/subagents/` to `agents/overrides/`
2. Make your modifications in the `overrides/` version
3. The override file takes precedence over the cached version

## Directory Structure

```
~/.config/opencode/orxa/agents/
├── subagents/     # Cached built-in agents (DO NOT EDIT)
├── overrides/     # Your customizations (EDIT HERE)
└── custom/        # Completely new agents
```

## What Gets Updated Automatically?

- Agent YAML definitions
- System prompts
- Tool configurations
- Default parameters

## See Also

- [`agents/overrides/README.md`](../overrides/README.md) - How to customize built-in agents
- [`agents/custom/README.md`](../custom/README.md) - How to create new custom agents
