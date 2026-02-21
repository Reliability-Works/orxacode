# OpenCode Orxa - Agent Definitions

This directory contains the agent definitions for the OpenCode Orxa plugin.

## Directory Structure

```
agents/
├── README.md              # This file
├── orxa.yaml         # Primary: Engineering Manager
├── plan.yaml             # Primary: Product Manager/Strategist
├── subagents/            # All subagent definitions
│   ├── README.md         # Subagent customization guide
│   ├── strategist.yaml
│   ├── reviewer.yaml
│   ├── build.yaml
│   ├── coder.yaml
│   ├── frontend.yaml
│   ├── architect.yaml
│   ├── git.yaml
│   ├── explorer.yaml
│   ├── librarian.yaml
│   ├── navigator.yaml
│   ├── writer.yaml
│   ├── multimodal.yaml
│   └── mobile-simulator.yaml
└── custom/               # Your custom agent definitions
    └── (your agents here)
```

## Primary Agents

### Orxa (`orxa.yaml`)

**Role**: Engineering Manager / Workforce Orchestrator  
**Model**: `opencode/kimi-k2.5`  
**Mode**: Primary

The Orxa is the central orchestrator. It does NOT write code directly - it delegates all work to specialized subagents.

**Key Responsibilities**:
- Maintain TODO lists and track progress
- Delegate tasks to appropriate subagents
- Run quality gates before marking work complete
- Save important context to supermemory
- Enforce the Orxa/Manager pattern

**Allowed Tools**:
- `read` - Read files for planning
- `delegate_task` - Delegate work to subagents
- `todowrite` / `todoread` - Manage TODOs
- `supermemory` - Read/write memories
- `edit` / `write` - **Only for `.orxa/plans/*.md` files**

**Blocked Tools** (must delegate):
- `grep`, `glob` - Use `@plan` agent
- `bash` - Use appropriate subagent
- `agent-device` - Use `@mobile-simulator`

**Configuration**:
The Orxa cannot be customized via YAML (it's enforced by the plugin). Configuration is done via `~/.config/opencode/orxa/orxa.json`.

---

### Plan (`plan.yaml`)

**Role**: Strategic Planning Consultant / Product Manager  
**Model**: `opencode/gpt-5.3-codex`  
**Mode**: Primary

The Plan agent creates comprehensive work plans before any code is written. It interviews the user, researches the codebase, and generates executable plans.

**Key Responsibilities**:
- Interview users to clarify requirements
- Classify intent (Trivial, Exploratory, Ambiguous, Refactoring)
- Generate master work plans in `.orxa/plans/*.md`
- Include TODOs with atomic, verifiable items
- Add Memory Recommendations for @orxa

**Allowed Tools**:
- `read` - Read files
- `write` / `edit` - Write plan files
- `grep` / `glob` - Search codebase (reserved for this agent)
- `bash` - Run research commands

**Customization**:
Primary agents can only override the **model**. Other fields are ignored.

Create an override in `~/.config/opencode/orxa/agents/overrides/plan.yaml` and edit:
- `model` - Change to preferred model

---

## Subagents

See [subagents/README.md](./subagents/README.md) for the complete list of subagents and customization instructions.

## Custom Agents Directory (`agents/custom/`)

The `~/.config/opencode/orxa/agents/custom/` directory is for **your own custom agent definitions** that extend or supplement the default agent fleet.

### Use Cases

1. **Domain-Specific Agents**: Create agents specialized for your tech stack (e.g., `rust-expert.yaml`, `django-specialist.yaml`)
2. **Team-Specific Agents**: Agents tailored to your team's conventions and patterns
3. **Extended Capabilities**: Agents that combine multiple roles or have unique tool access

### How to Create Custom Agents

1. Create a YAML file in `~/.config/opencode/orxa/agents/custom/`:

```yaml
# ~/.config/opencode/orxa/agents/custom/security-auditor.yaml
name: security-auditor
description: Security audit specialist. Finds vulnerabilities and suggests fixes.
mode: subagent
model: opencode/gpt-5.3-codex
temperature: 0.1
system_prompt: |
  You are a security specialist. Your job is to find vulnerabilities.

  ## Focus Areas
  - SQL injection risks
  - XSS vulnerabilities
  - Authentication flaws
  - Dependency vulnerabilities

  ## Memory Protocol
  - No direct writes: you are forbidden from using supermemory add.
  - Provide Memory Recommendations for @orxa.

tools:
  - read
  - grep
  - bash
```

2. Reference your custom agent in delegations:

```yaml
# In your plan file
delegate_task:
  agent: security-auditor  # Will use ~/.config/opencode/orxa/agents/custom/security-auditor.yaml
  prompt: |
    ## Task
    Audit the authentication flow for vulnerabilities.
    ...
```

### Custom Agent Discovery

The plugin automatically discovers agents in this order:
1. User custom agents in `~/.config/opencode/orxa/agents/custom/*.yaml`
2. User overrides in `~/.config/opencode/orxa/agents/overrides/*.yaml`
3. Plugin's bundled agents

### Best Practices

- **Keep the Memory Protocol**: Always include "No direct writes" rule
- **Clear descriptions**: Help the Orxa choose the right agent
- **Minimal tool sets**: Only grant tools the agent actually needs
- **Document assumptions**: Explain what the agent expects in context

## Configuration Overview

### Agent Configuration Priority

1. **User overrides** (`~/.config/opencode/orxa/agents/overrides/`)
2. **Plugin defaults** (bundled definitions)

### JSON Configuration

For non-YAML configuration, use `~/.config/opencode/orxa/orxa.json`:

Primary agents (`orxa`, `plan`) only accept `model` overrides. Subagents can be fully customized.

```json
{
  "agent_overrides": {
    "orxa": {
      "model": "opencode/gpt-5.3-codex"
    },
    "strategist": {
      "model": "anthropic/claude-opus",
      "system_prompt": "Custom prompt...",
      "temperature": 0.2,
      "tools": {
        "allowed": ["read", "grep"]
      },
      "customInstructions": "Add domain-specific guidance."
    }
  },
  "subagents": {
    "overrides": {
      "coder": {
        "model": "anthropic/claude-3.5-sonnet"
      }
    }
  }
}
```

See the main [README.md](../README.md) for full configuration options.

## Agent Selection Guide

| Task Type              | Agent               | When to Use                     |
|------------------------|---------------------|---------------------------------|
| Create work plan       | `@plan`             | Before starting any work        |
| Risk analysis          | `@strategist`       | For complex or ambiguous tasks  |
| Review plan            | `@reviewer`         | Before executing a plan         |
| Complex implementation | `@build`            | Multi-file features, refactors  |
| Quick bug fix          | `@coder`            | Single file, localized change   |
| UI/UX work             | `@frontend`         | Styling, components, animations |
| Architecture decisions | `@architect`        | Design patterns, system design  |
| Git operations         | `@git`              | Commits, branches, merges       |
| Find code              | `@explorer`         | "Where is X?" questions         |
| Research docs          | `@librarian`        | External library questions      |
| Browse web             | `@navigator`        | Live web research               |
| Write docs             | `@writer`           | READMEs, documentation          |
| Analyze images/PDFs    | `@multimodal`       | Visual content analysis         |
| Mobile testing         | `@mobile-simulator` | iOS/Android simulator tasks     |

## See Also

- [Subagents Guide](./subagents/README.md) - Customizing subagents
- [Main README](../README.md) - Plugin overview and installation
- [Specification](../opencode-orxa-spec.md) - Full technical specification
