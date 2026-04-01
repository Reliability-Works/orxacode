# Remaining Product Work

**Updated:** 2026-04-01

This file only tracks work that is still to do.

## 1. Claude + Codex native commands -> real Orxa actions

Goal:
- turn the provider command browser from reference-only into a usable control surface

Still to do:
- wire actionable mappings for the high-value commands:
  - `Claude`: `/resume`, `/plan`, `/model`, `/permissions`, `/diff`
  - `Codex`: `/resume`, `/plan`, `/model`, `/permissions`, `/diff`
- each mapped command must either:
  - execute the equivalent Orxa action directly, or
  - open/focus the correct Orxa UI surface
- do not forward raw slash command text into the provider prompt unless the runtime explicitly supports that path

Done enough already:
- provider-native command discovery browser exists for Claude and Codex

## 2. Provider-native hooks browser

Goal:
- make hooks visible and configurable from the desktop app

Still to do:
- Claude:
  - list configured hooks
  - show trigger points
  - provide edit/open affordances into the relevant config surface
- Codex:
  - confirm upstream hook/config support
  - expose equivalent hook discovery if supported
- keep provider naming explicit when Orxa terminology differs

## 3. Claude memory and instruction layering browser

Goal:
- show what Claude is actually using as instruction context

Still to do:
- browse and distinguish:
  - project memory
  - user/global memory
  - `CLAUDE.md` and related project instruction files
  - agent/subagent instruction layers where surfaced
- distinguish:
  - editable local files
  - derived/runtime-only layers
  - provider-owned layers

## 4. Skills, apps, MCP, and agent discovery

Goal:
- surface provider-native extensibility directly in Orxa

Still to do:
- Claude:
  - skills discovery
  - agents discovery
  - MCP discovery and status
- Codex:
  - apps discovery
  - skills discovery
  - MCP discovery and status
  - agent/personality discovery where upstream supports it

## 5. Diagnostics, health, and usage center

Goal:
- replace scattered provider debugging with one deliberate diagnostics area

Still to do:
- shared diagnostics entry point in Orxa
- Claude details:
  - auth/health state
  - session status
  - usage visibility where available
  - troubleshooting entry points
- Codex details:
  - app-server status
  - usage/session status
  - model/account/collaboration metadata where useful
  - troubleshooting entry points

## Not in scope

Do not spend time on direct parity for terminal-only surfaces that Orxa already solves better:
- `/ide`
- `/config`
- voice/mobile companion surfaces
- remote handoff / teleport features
- provider-branded quota upsell UI

## Next tranche

Do this next:
1. action mapping for the native command browser
2. hooks browser
3. Claude memory/instruction browser
