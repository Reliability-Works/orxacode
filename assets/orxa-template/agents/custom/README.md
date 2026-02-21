# Custom Agents Directory

This folder is for creating **completely custom agents** that don't exist in the built-in set.

## What Are Custom Agents?

Custom agents are entirely new AI agents you create for specific purposes. Unlike overrides (which modify existing agents), custom agents are unique to your workflow.

## Complete Agent YAML Example

Create a new file like `agents/custom/my-custom-agent.yaml`:

```yaml
---
name: my-custom-agent
description: A specialized agent for database migrations and schema design
mode: subagent
model: opencode/kimi-k2.5
temperature: 0.3
tools:
  - read
  - edit
  - write
  - bash
  - grep
  - glob
  - supermemory
permissions:
  allow:
    - read
    - edit
    - write
    - bash
  deny:
    - skill
---

You are a database migration specialist focused on safe schema evolution.

## Role
Design and implement database migrations with zero-downtime guarantees.

## Capabilities
- Analyze existing schema
- Design migration strategies
- Generate rollback scripts
- Validate data integrity

## Rules
1. Always create rollback scripts before migrations
2. Use transactions for atomic operations
3. Test migrations on copies of production data
4. Document breaking changes

## Memory Protocol
- Save migration patterns to supermemory
- Document common pitfalls and solutions
```

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the agent (used in delegation) |
| `description` | Yes | Short description shown in agent listings |
| `mode` | Yes | Must be `subagent` for custom agents |
| `model` | Yes | AI model to use (e.g., `opencode/kimi-k2.5`) |
| `temperature` | No | Creativity level 0.0-1.0 (default: 0.2) |
| `tools` | No | List of available tools |
| `permissions` | No | Fine-grained tool permissions |
| Content after `---` | No | System prompt and instructions |

## Registering Custom Agents

After creating a custom agent, register it in your `orxa.json`:

```json
{
  "custom_agents": ["my-custom-agent"]
}
```

Or use the CLI:
```bash
orxa agent add my-custom-agent
```

## Best Practices

1. **Use descriptive names** - Make it clear what the agent does
2. **Keep system prompts focused** - Define specific capabilities and constraints
3. **Limit tools** - Only grant tools the agent actually needs
4. **Document thoroughly** - Include examples and edge cases in the prompt
5. **Test iteratively** - Refine based on delegation results

## Example Use Cases

- **Security Reviewer** - Specialized in security audits
- **Performance Optimizer** - Focuses on code performance
- **API Designer** - Designs REST/GraphQL APIs
- **Test Generator** - Creates comprehensive test suites
- **Documentation Writer** - Maintains technical docs

## See Also

- [`agents/subagents/README.md`](../subagents/README.md) - About cached built-in agents
- [`agents/overrides/README.md`](../overrides/README.md) - Customizing existing agents
