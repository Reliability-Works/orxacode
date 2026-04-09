# Orxa Code Subagent Threads Spec

## Status

- [x] Product direction agreed
- [x] Primary UX agreed: sidebar-first child threads
- [x] Child thread view agreed: normal chat pane, read-only, no composer
- [ ] Shared thread-link data model implemented
- [ ] Codex subagent threads shipped and manually validated
- [ ] OpenCode subagent threads shipped and manually validated
- [ ] Claude subagent threads shipped and manually validated
- [ ] Optional active-subagents drawer evaluated after all three providers work

## Purpose

This spec defines how Orxa Code should surface delegated subagents as first-class child threads.

The goal is not to add another transient progress panel.

The goal is:

- delegated work is visible
- delegated prompts are inspectable
- delegated output is readable as a normal thread
- delegated threads can be archived when finished
- the same core model works for Codex, OpenCode, and Claude

## Hard Decisions

- Use the left sidebar as the primary navigation surface for subagents.
- Represent subagents as child threads under the parent thread.
- Open child threads in the normal chat pane.
- Hide the composer in child-thread view.
- Keep parent-thread summaries for delegated work, but do not rely on summary rows as the only surface.
- Roll out providers in this order:
  1. Codex
  2. OpenCode
  3. Claude
- Do not begin the next provider until the current provider passes its manual validation prompt and exit criteria.

## Non-Goals

- No composer-top subagent drawer in the first pass
- No mixed “some providers use child threads, some use task rows only” end state
- No dual UI model where subagents are first-class in one place and transient in another
- No write-capable child-thread composer in the first pass

## Target UX

## Sidebar

- Parent threads can show expandable child-thread groups.
- Child threads render indented beneath the parent thread.
- Child rows show:
  - title
  - provider
  - model
  - agent/subagent label where available
  - running/completed/error status
  - archive action when allowed
- Running child threads auto-expand beneath the parent.
- Completed child threads remain available but collapsed by default after first read.

## Child Thread View

When a child thread is opened, use the normal chat pane shell with a read-only child-thread mode:

- show timeline/messages/tool output/approvals exactly like a normal thread
- hide composer entirely
- show header metadata:
  - child title
  - parent title
  - provider
  - model
  - agent/subagent name
  - current state
  - “Open parent” action
- render the delegated prompt as the first user message in the child thread

## Archive Behavior

- Child threads use the existing thread archive lifecycle.
- Archived child threads leave the live sidebar tree and move to the normal archive surface.
- Parent threads remain visible even if all children are archived.

## Shared Architecture

## Principle

A subagent is a thread relation, not a special activity row.

## Required Shared Model

Add a generalized thread-link model instead of adding more one-off provider-specific fields.

Minimum relation shape:

- `parentThreadId`
- `childThreadId`
- `relationKind`
- `parentTurnId`
- `provider`
- `providerTaskId`
- `providerChildThreadId`
- `agentLabel`
- `createdAt`
- `completedAt`
- `archivedAt`

Initial `relationKind` values:

- `subagent`
- `plan_implementation`
- `handoff`

## Required Shared Behavior

- A child thread must be a first-class orchestration thread.
- A child thread must be linkable back to a parent thread and parent turn.
- A child thread must support normal archive/unarchive.
- A child thread must be readable even after the parent turn completes.
- Parent timelines may keep compact delegated-work summaries, but child-thread data must not depend on those summaries for correctness.

## Shared UI Work

- Extend sidebar render logic to support parent -> child thread trees.
- Extend thread routing/state so the active thread can be a child thread.
- Add child-thread read-only mode to the chat view.
- Add parent breadcrumb/open-parent affordance in the header.

## Shared Validation Rules

Every provider phase must satisfy all of the following before moving on:

- child thread appears under the correct parent thread
- child thread opens in the main chat pane
- child thread hides the composer
- delegated prompt is visible as the first user message
- streamed output is visible in the child thread
- parent thread still shows compact delegated progress
- child thread can be archived after completion
- archive/unarchive behaves like any other thread
- no regression to normal non-subagent threads
- targeted tests pass
- `pnpm typecheck` passes
- `pnpm lint` passes

## Phase 1: Codex

## Why First

Codex already has the strongest signal in the current Orxa implementation:

- child collaboration conversations are detected
- child provider thread ids are linked back to the parent turn
- child lifecycle notifications are currently suppressed instead of surfaced

That makes Codex the best first provider to prove the model.

## Codex Scope

- stop flattening child collaboration work into parent-only visibility
- materialize Codex child conversations as child threads
- persist parent/child linkage in the shared thread-link model
- route child output into the child thread timeline
- keep parent progress summaries

## Codex Implementation Notes

- create child thread records when collaboration child thread ids are discovered
- use the collaboration tool input to create the first child-thread user message
- preserve existing approval routing, but attach approvals to the child thread where appropriate
- ensure parent-thread status does not get replaced by child lifecycle events

## Codex Manual Validation Prompt

Use a Codex thread in this repo and send:

```text
Investigate how provider-backed sessions and sidebar thread rendering work in this repo.
Delegate this work in parallel.
Use one collaborator to inspect apps/server/src/provider and apps/server/src/orchestration.
Use another collaborator to inspect apps/web/src/components/sidebar and apps/web/src/components/chat.
Return a concise summary with the key files each collaborator read.
Do not make any changes.
```

## Codex Validation Expectations

- at least two child threads appear beneath the parent thread
- each child thread title is understandable from its delegated task
- opening a child thread shows the delegated prompt
- child thread output contains its own reasoning/tool/message history
- completed child threads remain inspectable after the parent finishes

## Codex Exit Gate

- [ ] shared thread-link model supports Codex child threads
- [ ] Codex child threads render in sidebar
- [ ] Codex child thread view is read-only and composerless
- [ ] Codex validation prompt passes manually

## Phase 2: OpenCode

## Why Second

OpenCode upstream already supports subagents as child sessions and has explicit parent/child navigation semantics in its own UX.

Once Codex proves the Orxa data model and sidebar UX, OpenCode should slot into the same model cleanly.

## OpenCode Scope

- detect or create child-session linkage from OpenCode session semantics
- materialize OpenCode child sessions as child threads
- capture delegated prompt into the child thread
- render child-session output as child-thread timeline content

## OpenCode Implementation Notes

- use upstream child-session semantics as the source of truth
- reuse the shared thread-link model rather than introducing OpenCode-only child-session storage
- keep built-in OpenCode subagents and custom subagents compatible

## OpenCode Manual Validation Prompt

Use an OpenCode thread in this repo and send:

```text
Investigate how thread archiving and thread rendering flow from orchestration to the sidebar in this repo.
Delegate the work to subagents in parallel.
Use one subagent to inspect apps/server/src/orchestration and persistence layers.
Use one subagent to inspect apps/web/src/components/sidebar and session logic.
Return a concise summary with the key files each subagent read.
Do not make any changes.
```

## OpenCode Validation Expectations

- child sessions surface as child threads in the sidebar
- opening a child thread shows the delegated prompt and child output
- parent/child navigation works naturally through the sidebar tree
- archiving a completed OpenCode child thread behaves like any other thread

## OpenCode Exit Gate

- [ ] OpenCode child sessions map into shared thread-link model
- [ ] OpenCode child threads render in sidebar
- [ ] OpenCode child thread view is read-only and composerless
- [ ] OpenCode validation prompt passes manually

## Phase 3: Claude

## Why Third

Claude clearly supports subagents, but the current Orxa integration is less thread-native than Codex:

- Task/Agent tool invocation is already recognized
- task lifecycle is already captured
- subagent context is detectable
- but child-thread materialization is not yet present

Claude should reuse the proven shared model after Codex and OpenCode.

## Claude Scope

- create child-thread candidates from Agent/Task tool invocation
- correlate Claude subagent execution to child threads
- capture delegated prompt as first user message
- persist and render child output in the child thread

## Claude Implementation Notes

- prefer SDK stream correlation first
- if needed, enrich finished child threads from transcript data after completion
- keep the compatibility story for legacy `Task` and newer `Agent` naming

## Claude Manual Validation Prompt

Use a Claude thread in this repo and send:

```text
Review how provider runtime events become visible in the chat UI in this repo.
Delegate the work to parallel subagents.
Use one subagent to inspect apps/server/src/provider and apps/server/src/orchestration.
Use another subagent to inspect apps/web/src/session-logic and apps/web/src/components/chat.
Return a concise summary with the key files each subagent read.
Do not make any changes.
```

## Claude Validation Expectations

- Claude subagents appear as child threads
- opening a child thread shows the exact delegated prompt
- child thread output is readable without transcript spelunking
- parent thread still shows useful delegated progress summaries

## Claude Exit Gate

- [ ] Claude subagents map into shared thread-link model
- [ ] Claude child threads render in sidebar
- [ ] Claude child thread view is read-only and composerless
- [ ] Claude validation prompt passes manually

## Phase 4: Optional Active Subagents Drawer

Only consider this after all three providers pass.

Possible scope:

- compact live drawer above composer
- active child threads only
- click-through into real child threads
- no separate transcript model

This is optional polish, not part of the core provider rollout.

## Required Test and Verification Discipline

For each provider phase:

- add targeted tests for new thread-link mapping/projection behavior
- add targeted tests for sidebar child-thread rendering
- add targeted tests for child-thread read-only chat mode
- run affected targeted tests
- run `pnpm typecheck`
- run `pnpm lint`

## Stop Conditions

Stop the current phase and do not continue to the next provider if any of the following are true:

- child thread exists but delegated prompt is missing
- child output only appears in the parent and not in the child thread
- child thread can send new prompts
- archive behavior differs from normal thread lifecycle
- provider-specific implementation starts bypassing the shared thread-link model

## Completion Condition

This spec is complete only when:

- Codex, OpenCode, and Claude subagents all surface as child threads
- child threads open in the standard chat pane in read-only mode
- delegated prompts are visible
- child output is readable
- child threads can be archived
- manual validation prompts pass for all three providers
