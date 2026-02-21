---
model: opencode/kimi-k2.5
---

# ORXA Agent Model Override

This file overrides the model for the ORXA (Engineering Manager) primary agent.

## Usage

Edit the `model` field in the frontmatter above to change which model ORXA uses.

## Available Models

- `opencode/kimi-k2.5` - Default, good balance of capability and speed
- `openai/gpt-5.2` - Higher capability, slower
- `openai/gpt-5.2-codex` - Best for complex reasoning
- `opencode/gemini-3-pro` - Good for multimodal tasks

## Note

Only the `model` field is used from this file. Other fields (temperature, system_prompt, etc.) are ignored for primary agents.
