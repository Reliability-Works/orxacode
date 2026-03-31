# Provider Session Correctness And Unified Worktree Spec

**Status:** In progress  
**Date:** 2026-03-31  
**Scope owner:** Orxa Code app shell / provider session integration

## Summary

Orxa Code currently has three overlapping problems:

1. Claude Chat permission semantics are incorrect.
2. Provider session lifecycle is still too fragile across Claude Chat, Codex, and OpenCode.
3. Worktree/session UX is split by provider and by app area instead of feeling like one coherent desktop flow.

This spec defines the next implementation tranche.

The priority is not general OpenCode feature work. We are not taking on OpenCode-only backlog items like summarize UI, plugin browsers, or tool browsers in this scope.

The priority is:

1. Claude permission correctness.
2. Provider session lifecycle hardening.
3. Unified worktree/session experience across OpenCode, Codex, and Claude Chat.
4. Claude transcript parity, then Codex resume/replay parity.

## Status Update

The original tranche in this spec is now partially landed:

- Claude permission correctness is done.
- The main provider session lifecycle bugs that caused wrong-provider routing and duplicate draft rows are largely done.
- A first shared workspace/worktree/session model is in place.
- Claude transcript parity is done for the current parity bar.
- Claude past-session browse/import/resume is now landed through a dedicated provider browser backed by real Claude project-session inventory.
- Codex resumed-thread parity has improved materially.

The remaining work is now narrower and more product-facing:

- Codex still needs a clearer main session-browser import/resume experience beyond local-session recovery.
- Both Claude and Codex still need some first-class controls that are currently missing from the desktop product, especially budget/guardrail and compaction visibility.
- Claude now primarily needs undo/rewind affordances, budget guardrails, and real compaction visibility.

## Problem Statement

### 1. Claude permission semantics are wrong

Current behavior does not match the UI or user expectation.

- Claude Chat exposes `allow once`, `always allow`, and `reject`.
- `always allow` is currently flattened to the same one-shot `allow` behavior as `allow once`.
- Global composer `yolo-write` does not produce Claude behavior equivalent to Codex/OpenCode.
- Claude can still surface permission prompts even when the app is configured for yolo mode.

This is a correctness bug, not a missing enhancement.

### 2. Provider session lifecycle is still too coupled and too stateful

We have repeatedly hit issues where:

- provider-local sessions leak into OpenCode lifecycle paths
- synthetic/draft rows survive materialization too long
- archive/delete/load behavior depends on fragile transient registry state
- switching sessions or workspaces repairs UI state that should have been correct already

The app shell still treats too much provider behavior as a special case of OpenCode session lifecycle.

### 3. Worktree UX is fragmented

OpenCode has stronger worktree/session affordances than the other providers, but the user experience is inconsistent:

- worktree creation and session creation are not presented as one unified concept
- cleanup/listing/switching ergonomics are split across multiple surfaces
- provider-specific session models leak into the user-facing workflow

We need one worktree model and one session/worktree UX, not three separate ones.

## Goals

### G1. Make Claude permission behavior correct

- `allow once` must be one-shot.
- `always allow` must persist for the relevant Claude session scope.
- `yolo-write` must suppress routine Claude permission interruption in the same practical way it does for Codex/OpenCode.
- UI copy must match actual runtime behavior.

### G2. Harden provider session lifecycle

- Draft/synthetic/provider-local sessions must never leak into the wrong provider lifecycle path.
- Materialization from draft -> active session must replace the draft cleanly in all app surfaces.
- Archive/delete/load/rename/copy-id behavior must branch on provider/runtime truth, not stale metadata guesses.

### G3. Ship a unified worktree/session model

- Worktree creation, session launch, session listing, switching, and cleanup should feel provider-agnostic.
- The user should not have to understand provider-specific worktree behavior.
- Shared shell affordances should sit above provider implementations, not be reimplemented per provider.

### G4. Close the highest-value transcript parity gaps

- Claude transcript detail should move toward Codex/OpenCode quality.
- Codex resumed-thread playback should move toward live-session parity.

### G5. Make past-session recovery first-class

- Claude past-session inventory and import/resume should work independently of Orxa-local session history.
- Codex past-thread browsing/import should become clearer in the main browser flow, not only through recovery affordances.

## Non-Goals

This spec does **not** include:

- OpenCode-only feature work such as summarize UI, plugin browser, command manager UI, or tool browser UI.
- Raw transport debugging UIs.
- Remote/distributed session admin surfaces.
- Large OpenCode feature expansion unrelated to correctness or unified worktree UX.
- Claude terminal / canvas session redesign.

Claude terminal remains separate from this work except where shared worktree/session infrastructure can be reused safely.

## Guiding Decisions

### D1. Correctness before parity

Claude permission semantics are a blocker. They come before richer Claude transcript work.

### D2. Hard cutovers over dual paths

Where old session-routing or provider-coupling behavior is replaced, remove the obsolete branch instead of layering more fallback logic on top.

### D3. Shared session/worktree layer above providers

Provider services should remain provider-specific. Session/worktree orchestration should become shared app-shell infrastructure.

### D4. Provider-native behavior stays canonical

OpenCode, Codex, and Claude semantics should come from upstream/runtime behavior. Orxa should not invent conflicting meanings in the renderer.

## Workstreams

## Workstream A: Claude Permission Correctness

### A1. Implement true session-scoped allow for Claude Chat

Current state:

- `acceptForSession` exists in UI and IPC types.
- main-process service resolves it exactly like `accept`.

Required change:

- Introduce real session-scoped approval persistence for Claude Chat runtime sessions.
- Persist the effective allowance against the Claude session/runtime scope that future tool approvals consult.
- On subsequent tool approval callbacks in that same session, auto-allow without surfacing a new permission request when the remembered rule applies.

Acceptance:

- Clicking `always allow` once in a Claude Chat session prevents repeated prompts for equivalent follow-up tool approvals in that same session.
- `allow once` continues to apply only to the current approval.

### A2. Implement real yolo behavior for Claude Chat

Required change:

- Make Claude Chat obey app-level `yolo-write` end to end.
- If upstream `bypassPermissions` fully works, Orxa should not surface Claude permission prompts in yolo mode.
- If upstream still emits approval callbacks in some cases, Orxa must auto-resolve them in Claude just as Codex/OpenCode already do.

Acceptance:

- In Claude Chat, yolo mode does not leave the user stuck repeatedly approving routine tool actions.
- Claude permission UI remains visible only for cases that truly cannot be bypassed.

### A3. Align Claude permission UI copy and settings

Required change:

- Audit settings labels and composer labels so they describe actual Claude behavior.
- Stop calling behavior “auto-approve writes” if runtime intent is effectively broader full-access execution.

Acceptance:

- Settings, permission toast/dock, and runtime behavior all describe the same model.

## Workstream B: Provider Session Lifecycle Hardening

### B1. Make provider routing explicit and durable

Required change:

- Centralize session lifecycle routing by provider/runtime truth.
- OpenCode runtime actions should only ever receive real OpenCode runtime session ids.
- Claude/Codex/provider-local rows should never depend on synthetic-record existence alone to avoid wrong-path routing.

Acceptance:

- Archive/load/delete/rename logic stays correct even if local draft metadata is stale or already removed.

### B2. Fix draft materialization invariants

Required change:

- Draft rows must be replaced atomically when the real session/thread is created.
- Old draft records/cached rows must not survive async refreshes or stale callback closures.
- This must hold for OpenCode draft sessions, Claude Chat drafts, and Codex drafts.

Acceptance:

- Starting a session never temporarily shows both the draft/dummy row and the real row.
- Clicking around the sidebar should not be required to repair state.

### B3. Reduce app-shell dependence on provider-specific renderer state

Required change:

- Move more provider-session bookkeeping into focused hooks/services.
- Reduce the amount of provider-specific lifecycle branching living inline in `App.core.tsx`.
- Prefer extracted session/worktree orchestration helpers with narrow interfaces.

Acceptance:

- `App.core.tsx` shrinks further as this work lands.
- No new lint warnings are introduced.

## Workstream C: Unified Worktree And Session Experience

### C1. Define one shared worktree domain model

Required change:

- Introduce a shared worktree/session orchestration layer that all three chat providers can use.
- Represent:
  - worktree inventory
  - session-to-worktree association
  - active worktree/session switching
  - cleanup/archive affordances
  - branch/worktree creation entry points

This layer should be app-shell-owned, not provider-owned.

### C2. Unify session launch flows across providers

Required change:

- Starting OpenCode, Codex, or Claude Chat from a workspace should follow the same top-level UX:
  - choose workspace
  - optionally choose/create worktree
  - start session
  - show active session in the same sidebar/session browser pattern

### C3. Unify worktree cleanup ergonomics

Required change:

- Session cleanup and worktree cleanup should be discoverable from one coherent area.
- Avoid provider-specific cleanup logic leaking into user-facing controls.

Acceptance for Workstream C:

- The app has one understandable “workspace -> worktree -> session” model regardless of provider.
- The user does not need to care whether the underlying session is OpenCode, Codex, or Claude Chat to perform normal worktree operations.

## Workstream D: Claude Transcript Parity

This is still important, but it follows permission correctness and lifecycle hardening.

Required change:

- Improve Claude transcript detail for:
  - tool calls
  - command execution
  - exploration/context rows
  - file edits and diff provenance
  - retry/rate-limit visibility

Acceptance:

- Claude sessions explain what happened during a run at roughly the same practical debugging value as Codex/OpenCode.

## Workstream E: Codex Resume/Replay Parity

Required change:

- Bring resumed Codex threads up to live-session parity.
- Restore missing exploration/context items in resumed transcripts.
- Make past-thread browsing/import/resume clearer in the main session browser.

Acceptance:

- A resumed Codex thread should feel like the same session, not a degraded replay mode.

## Follow-On Workstreams

These are the next spec-promoted items pulled from `TODO.md` now that the original tranche is mostly implemented.

### F1. Claude Past-Session Browser And Resume

Required change:

- Add a real Claude session browser/resume flow for provider sessions beyond the ones created in the current app lifetime.
- Make provider-backed Claude session inventory visible in the same main browsing model as active workspace sessions where practical.

Acceptance:

- A user can browse and reopen meaningful past Claude sessions without relying on local draft/session bookkeeping alone.

### F2. Claude File Undo And Guardrails

Required change:

- Add rewind / undo affordances for Claude-driven file edits.
- Add long-run budget/task guardrails to the Claude GUI.

Acceptance:

- Claude users can both understand and bound risky long-running work without dropping to the CLI.

### F3. Claude Compaction And Main-Thread Capability Controls

Required change:

- Replace stubbed Claude compaction UI with real state.
- Add main-thread custom-agent selection and evaluate whether `acceptEdits`-style middle-ground permission behavior should be surfaced explicitly.

Acceptance:

- Claude composer controls reflect real runtime state and meaningful control options rather than placeholders.

### G1. Codex Main Session-Browser Import/Resume Flow

Required change:

- Extend Codex past-thread browsing so import/resume is obvious in the main session browser, not only via local-provider recovery flows.
- Make the separation between local Orxa session records and upstream Codex thread inventory explicit in the UI.

Acceptance:

- A user can discover and reopen upstream Codex threads from the main browser flow without needing to understand local session bookkeeping.

### G2. Codex Undo, Guardrails, And Compaction

Required change:

- Add undo / revert affordances for Codex-driven file changes.
- Add budget/task guardrails for longer Codex runs.
- Replace the inert Codex compaction meter with real compaction state.

Acceptance:

- Codex long-run controls match the sophistication of the rest of the live session UX instead of trailing behind the transcript/runtime features.

### G3. Provider-Native Capability Discovery For Claude And Codex

Required change:

- Add provider-aware discovery surfaces for the highest-value native capability categories:
  - slash commands
  - hooks / notification config
  - skills / apps / connectors
  - custom subagents or AGENTS-adjacent capability definitions

Acceptance:

- Claude and Codex no longer feel like runtime-only integrations; users can discover their provider-native capability surfaces inside Orxa.

## Priority Order

### P0

- Claude permission correctness:
  - session-scoped allow
  - yolo enforcement
  - UI copy alignment

### P1

- Draft/materialization/session lifecycle hardening across all three chat providers.

### P2

- Unified worktree/session model and shared UX.

### P3

- Claude transcript parity.
- Codex resume/replay parity.

### P4

- Claude past-session browser/resume.
- Claude undo / guardrails / compaction state.
- Codex main session-browser import/resume clarity.
- Codex undo / guardrails / compaction state.

### P5

- Provider-native capability discovery for Claude and Codex.

## Explicitly Deferred

- OpenCode summarize UI.
- OpenCode plugin browser.
- OpenCode tool browser.
- OpenCode-only command manager UI.
- Provider OAuth/MCP auth flows.
- Memory feature rollout.

These can be revisited later, but they are not the next spec target.

## Testing And Validation Requirements

For implementation work under this spec:

- Add regression tests for every session-lifecycle bug that is testable.
- Prefer small deterministic hook/service tests over flaky root-App harness tests.
- Run after each implementation slice:
  - targeted `vitest` for touched areas
  - `pnpm typecheck --pretty false`
  - `pnpm lint`

Behavioral validation should explicitly cover:

- Claude `allow once` vs `always allow`
- Claude yolo mode
- draft -> real session materialization without duplicate sidebar rows
- archive/delete/load routing by provider
- unified worktree switching across OpenCode, Codex, and Claude Chat

## Success Criteria

This spec is complete when all of the following are true:

- Claude `always allow` actually persists for the intended session scope.
- Claude yolo mode behaves like a true full-send mode in normal flows.
- Starting any session type does not create a transient duplicate/dummy sidebar row.
- Provider-local sessions never route through the wrong provider lifecycle path.
- Worktree/session UX is visibly unified across OpenCode, Codex, and Claude Chat.
- `App.core.tsx` complexity trends down rather than up as this work lands.
- Claude has a real past-session browser/resume story and no longer depends mainly on current-lifetime local session records.
- Codex past-thread import/resume is clear in the main session browser, not just recoverable from local-provider glue.
- Claude and Codex both surface budget/guardrail and compaction state meaningfully in the GUI.

## Open Questions

- What exact persistence scope should Claude `acceptForSession` use?
  - current runtime only
  - current Orxa session key
  - provider thread id
- Which Claude tool approvals are safe to auto-approve under yolo if upstream still emits callbacks despite bypass mode?
- Should unified worktree inventory live in app shell state only, or have a shared service boundary in Electron as well?
- Do we want one combined “sessions + worktrees” browser, or keep worktrees as a detail view under workspaces?
