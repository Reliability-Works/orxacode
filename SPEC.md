# Orxa Code Live Rail Spec

## Status

- [x] Product direction agreed
- [x] Replace old subagent-thread-only spec with live-rail spec
- [ ] Investigation phase completed
- [ ] Shared live-rail model implemented
- [ ] Shared stacking shell implemented
- [ ] Codex task list surface shipped and manually validated
- [ ] Codex live subagent rail shipped and manually validated
- [ ] OpenCode task list surface shipped and manually validated
- [ ] OpenCode live subagent rail shipped and manually validated
- [ ] Claude task list surface shipped and manually validated
- [ ] Claude live subagent rail shipped and manually validated
- [ ] Shared polish pass completed

## Purpose

This spec defines a single live surface above the composer for provider-native session state.

The current problem is not that we lack history.

The current problem is that we only surface live state as vague worklog rows like:

- `Task list updated`
- `Subagent update`
- `Queued`

That loses useful structure already produced by Codex, OpenCode, and Claude.

The goal is:

- show the current task list or plan as a real checklist
- show live subagents as actionable items, not buried history
- keep queued messages and terminals in the same visual system
- make the rail a shared host for future live surfaces
- keep worklog as immutable history, not the only place current state exists

## Core Decision

Use a single stacked live rail above the composer.

The rail is:

- attached to the composer with no gap
- narrower than or equal to the composer width, following the same anchor
- vertically stacked
- collapsible per card
- the home for mutable session state

This rail will host:

- task list / plan
- queued messages
- active subagents
- running terminals
- later: approvals or other live status blocks if needed

## Hard Decisions

- Worklog remains the immutable timeline.
- Live rail shows only current state.
- Sidebar remains the primary long-term navigation model for threads.
- Parent thread rows with children are collapsed by default in the sidebar.
- Clicking a subagent item in the live rail expands the parent in the sidebar and opens that child thread.
- Subagent child threads still open in the main chat pane as normal read-only threads.
- Live rail cards stack in one shared shell instead of bespoke unrelated drawers.
- Do not start with every provider-specific nuance at once; use provider-by-provider rollout.
- Do not move to the next provider phase until the current one is manually validated.

## Non-Goals

- No replacement of the worklog
- No sidebar-only task list solution
- No modal for plans
- No separate “subagent drawer system” and “queue drawer system”
- No attempt to make all three providers expose identical raw semantics
- No hidden ephemeral split-pane-only sessions in this spec

## Information Architecture

## Separation Of Concerns

- Live rail: current mutable state
- Worklog: historical updates
- Sidebar: navigation tree
- Chat pane: primary transcript surface

## Why This Matters

Task lists and subagents are not the same kind of information as worklog rows.

They are:

- revisited repeatedly while the turn is active
- better as structured state than prose
- interactive

So they belong near the composer and current session context.

## Rail Model

The live rail is a stacked list of cards.

Each card has:

- `surfaceKind`
- `threadId`
- `provider`
- `title`
- `collapsed`
- `priority`
- `updatedAt`
- `dismissible`
- `body`

Initial `surfaceKind` values:

- `task_list`
- `queued_messages`
- `active_subagents`
- `running_terminals`

## Shared Card Rules

- Only render a card if its content is currently relevant.
- Cards are sorted by immediacy, not provider.
- Cards can be collapsed independently.
- Expanded cards keep content short and scannable.
- The rail should not grow unbounded; cards should collapse or summarize when large.

## Visual Rules

- The bottom-most visible rail card owns the rounded top corners.
- Cards stacked above it lose rounded bottom edges and become vertically flush.
- If another card sits above the task list, that upper card inherits the outer radius instead.
- The stack background should be slightly darker than the composer and lighter than the chat background.
- Visual language should match the terminal drawer / queue tray direction already in the app.

## Initial Card Order

Recommended order:

1. `queued_messages`
2. `task_list`
3. `active_subagents`
4. `running_terminals`

Reason:

- queued messages are closest to immediate user intent
- task list is the main current-session execution model
- subagents are active delegated work
- terminals are important but usually more infrastructure-like

This can be revised later if real usage shows a better order.

## Task List Card

## Behavior

- Show only the latest active task list for the current thread.
- Older task list versions remain in worklog/history.
- If a provider emits a plan update, update the card and add a worklog note.
- If the provider emits no structured plan, do not invent one unless Orxa explicitly derives one later as a separate feature.

## Collapsed State

- `Task list`
- progress summary like `2/5 complete`
- optional provider badge
- changed indicator if updated since last expansion

## Expanded State

- flat checklist rows
- row state:
  - pending
  - in progress
  - complete
  - blocked
- short text only
- no nested checklist tree in v1

## Provider Rules

We should not assume all three providers expose plans in the same way.

So v1 must define a normalization layer:

- Codex:
  - use Codex-native task/plan updates when present
  - if Codex emits a clear checklist state, map directly
- OpenCode:
  - use OpenCode-native task or planning signals when present
  - preserve any agent/task semantics that clarify ownership
- Claude:
  - use Claude task-list / plan-update signals when clearly structured
  - do not overfit to prose-only reasoning updates

Promotion rule:

- show in rail only when we have a structured or confidently-structured list
- otherwise keep the update in worklog only

## Subagent Card

## Purpose

Show active delegated work in one glanceable place without making the sidebar noisy.

Sidebar remains collapsed by default.

The rail becomes the live entry point while work is active.

## Behavior

- One `active_subagents` card per active parent thread
- Each row represents one child subagent thread
- Clicking a row:
  - expands the parent thread in the sidebar
  - highlights or reveals the child row
  - opens the child thread

## Row Content

Each row should show:

- agent name if known
- model
- prompt excerpt
- current status

Fallback rules:

- if agent name is known:
  - show `Agent Name · Model`
- if agent name is not known:
  - show `Model`
- always show prompt excerpt beneath or inline after metadata
- prompt may be truncated to fit; this is acceptable

## Provider Notes

- Codex:
  - likely best chance of name + model + prompt
- OpenCode:
  - should show configured agent type/name and delegated prompt
- Claude:
  - if explicit agent name is not consistently available, at minimum show model + prompt excerpt

## Sidebar Rules

- Parent rows with children are collapsed by default.
- Creating subagents should not auto-expand the sidebar tree by itself.
- Rail click expands the relevant parent on demand.
- Once expanded, normal sidebar navigation rules apply.

## Child Thread View

This spec does not change the child-thread read model already agreed conceptually:

- child threads still open in the main chat pane
- child threads are read-only
- composer hidden
- delegated prompt remains visible in the child thread
- provider/model metadata remains visible in header

## Queued Messages Card

- Keep the existing queue tray direction
- It now becomes one card in the shared rail
- queued items remain restorable/removable
- queue keeps FIFO semantics

## Running Terminals Card

- Existing terminal drawer behavior should migrate into the same rail shell over time
- show terminal count in collapsed mode
- expanded mode shows currently running commands and click-through

This is not the first implementation target, but the shell should be designed so terminal adoption is trivial later.

## Investigation Phase

Do this before any implementation.

## Purpose

We need to map exactly where each provider emits:

- task list or plan signals
- delegated subagent signals
- agent name metadata
- model metadata
- delegated prompt metadata

We also need to map where the current queue tray and terminal drawer logic already live so the rail shell can replace them cleanly.

## Investigation Deliverables

- provider event/source map for Codex
- provider event/source map for OpenCode
- provider event/source map for Claude
- current renderer surfaces map:
  - queue tray
  - terminal drawer
  - worklog
  - sidebar expansion state
- normalization proposal for:
  - `task_list`
  - `active_subagents`

## Investigation Exit Gate

- [x] exact provider event sources identified for all three providers
- [x] exact renderer insertion point identified for the rail shell
- [x] exact sidebar expansion/open-thread integration points identified
- [x] normalization rules written down before phase 1 implementation

## Investigation Findings

### Renderer Surface Map

- Shared rail insertion point:
  - `apps/web/src/components/chat/ChatViewComposerBody.tsx`
  - the current `ComposerQueuedMessagesTray` is already rendered directly above the composer surface inside the same outer shell
  - this is the hard-cutover anchor for the new stacked live rail host
- Current queued-message surface:
  - `apps/web/src/components/chat/ComposerQueuedMessagesTray.tsx`
  - queue actions and restore/remove behavior live in `apps/web/src/components/chat/useChatViewController.queued.ts`
- Current task-list surface:
  - right-hand panel rendered from `apps/web/src/components/chat/ChatViewInner.tsx`
  - panel implementation lives in `apps/web/src/components/PlanSidebar.tsx`
  - toggle state is `planSidebarOpen` in `apps/web/src/components/chat/useChatViewLocalState.ts`
  - footer buttons still route through `apps/web/src/components/chat/ChatViewComposerControlsExpanded.tsx` and `apps/web/src/components/chat/ChatViewComposerFooterPanel.tsx`
- Current terminal surface:
  - `ThreadTerminalDrawer` is mounted from `apps/web/src/components/chat/ChatViewInner.tsx`
  - selection/interaction helpers live in `apps/web/src/components/ThreadTerminalDrawer.logic.ts`
  - this is not yet using the composer-top shell
- Current worklog/timeline surface:
  - worklog rows are derived in `apps/web/src/session-logic.activity.ts`
  - timeline composition happens in `apps/web/src/components/chat/useChatViewDerivedActivities.ts`
  - proposed plans are still injected into the transcript timeline as `proposed-plan` rows

### Sidebar And Navigation Findings

- Parent/child threading is already derived from `parentLink` in `apps/web/src/components/sidebar/useSidebarRenderedProjects.ts`
- Opening a thread in the focused pane is already handled in `apps/web/src/components/sidebar/useSidebarThreadNavigation.ts`
- Important gap:
  - child threads are nested visually today
  - they are not collapsible per parent
  - `buildRenderedThreadEntries` currently always appends child rows under a visible parent
- So the requested behavior:
  - parent thread rows collapsed by default
  - rail click expands parent and opens the child
  requires new sidebar expansion state for parent thread trees
- This is different from the existing project-level thread-list expansion state

### Plan / Task List Findings

- Structured plan state is already first-class thread data:
  - proposed plans are stored in thread read model state
  - activity-derived active plan state is computed separately
- Current derivation path:
  - `apps/web/src/components/chat/useChatViewDerivedPlan.ts`
  - `activeProposedPlan` comes from `thread.proposedPlans`
  - `sidebarProposedPlan` comes from latest turn + source proposed plan linkage
  - `activePlan` comes from activity-derived plan steps
- Current history path:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeActivities.ts`
  - `turn.plan.updated` becomes `Plan updated` worklog history
- Current transcript path:
  - `apps/web/src/session-logic.activity.ts`
  - `deriveTimelineEntries` still inserts proposed-plan rows into the transcript

### Provider Event Source Map

#### Codex

- Structured checklist/task-list signal:
  - `apps/server/src/provider/Layers/CodexRuntimeEventMapper.threadTurn.ts`
  - native `turn/plan/updated` maps directly to `turn.plan.updated`
- Proposed-plan markdown buffering:
  - `apps/server/src/provider/Layers/CodexRuntimeEventMapper.items.ts`
  - emits `turn.proposed.delta`
  - finalized into proposed plans in ingestion on turn completion
- Subagent/delegation history and child-thread routing:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeActivities.ts`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.processEvent.ts`

#### OpenCode

- Structured checklist source exists through tool-backed todo events:
  - `apps/server/src/provider/Layers/OpencodeAdapter.toolSummary.ts`
  - `todowrite` tool input carries structured `todos`
  - `question` tool input carries structured `questions`
- Current adapter preservation path:
  - `apps/server/src/provider/Layers/OpencodeAdapter.parts.ts`
  - tool lifecycle `item.started` / `item.updated` / `item.completed` events preserve `payload.data`
  - `payload.data.input` can carry the underlying todo/question arrays
- Relevant planning/task sources also found:
  - plan mode dispatch exists in `apps/server/src/provider/Layers/OpencodeAdapter.runtime.turns.ts`
  - subagent task metadata is preserved through the `task` tool and `subtask` part paths
- Active subagent metadata source:
  - `apps/server/src/provider/Layers/OpencodeAdapter.parts.ts`
  - `subtask` parts emit `collab_agent_tool_call` with agent label, prompt, description, and model
- Child-session enrichment and delegation linking:
  - `apps/server/src/provider/Layers/OpencodeAdapter.runtime.events.ts`
  - `apps/server/src/opencodeChildThreads.ts`
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.opencodeSubagents.ts`

#### Claude

- No direct `turn.plan.updated` equivalent exists in the current Claude adapter
- Structured checklist source likely exists through generic built-in tool events:
  - upstream Claude exposes `TodoWrite` as a built-in tool
  - local adapter preserves generic tool input in lifecycle payloads
  - `apps/server/src/provider/Layers/ClaudeAdapter.runtime.messages.ts`
  - `item.started` / `item.updated` / `item.completed` all carry `payload.data.input`
- Structured proposed-plan capture exists through plan-mode exit flow:
  - `apps/server/src/provider/Layers/ClaudeAdapter.runtime.messages.ts`
  - `apps/server/src/provider/Layers/ClaudeAdapter.runtime.events.ts`
  - `ExitPlanMode` payloads can be captured into proposed-plan markdown
- Task lifecycle summaries exist, but they are not a native checklist structure:
  - `apps/server/src/provider/Layers/ClaudeAdapter.runtime.system.ts`
- Subagent classification source:
  - `apps/server/src/provider/Layers/ClaudeAdapter.pure.ts`
  - `Task` / agent-marked tools classify as `collab_agent_tool_call`
- Claude child-thread enrichment:
  - `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.claudeSubagents.ts`

### Normalization Decisions From Investigation

- `task_list` surface v1:
  - normalize from either:
    - structured plan state
    - structured todo/checklist tool payloads
  - Codex:
    - use `turn.plan.updated` and proposed-plan state first
  - OpenCode:
    - use `todowrite` tool payloads as the primary checklist source
    - `question` can be treated as adjacent structured state later, but not part of the checklist card in v1
  - Claude:
    - use `TodoWrite` tool payloads when present
    - fall back to proposed-plan markdown from `ExitPlanMode`
  - do not collapse structured checklist state down to count-only summaries in the rail
- `active_subagents` surface v1:
  - use child-thread-backed rows, not worklog rows
  - source metadata should come from provider child/delegation enrichment first
  - fallback order:
    - agent name + model + prompt excerpt
    - model + prompt excerpt
    - prompt excerpt only as a last resort
- Rail click behavior:
  - must set new parent-thread expansion state in the sidebar
  - then reuse focused-pane navigation to open the child thread
- Hard cutover target:
  - replace the current composer-top queue tray with a generic rail host
  - move the plan surface out of the right-hand `PlanSidebar`
  - keep worklog/timeline history intact

## Investigation Outcome

- Investigation phase is complete
- Phase 0 should start with:
  - a shared rail host in `ChatViewComposerBody.tsx`
  - new sidebar parent-thread expansion state
  - queue tray migrated into the host as the first card

## Upstream Verification Notes

- Codex:
  - official app-server README confirms explicit thread/turn/item lifecycle and steering semantics
  - `turn/plan/updated` remains the canonical structured plan signal
- OpenCode:
  - upstream tool model uses `task`, `todowrite`, and related tool names rather than a single generic plan event
  - `task` carries `description`, `prompt`, `subagent_type`, optional `task_id`, and optional `command`
  - `task` sessions are created as child sessions under the parent session
- Claude:
  - upstream Claude docs list `TodoWrite` as a built-in tool
  - local adapter already treats built-in tool invocations generically enough that `TodoWrite` can be normalized from tool payload input instead of needing a bespoke protocol event

## Shared Implementation Plan

## Phase 0: Rail Shell

Build the shared rail shell first.

Scope:

- stacked card host above composer
- shared collapse state
- shared ordering
- shared rounded-corner inheritance rules
- no provider-specific heavy logic yet

Exit gate:

- [ ] rail shell renders
- [ ] multiple cards can stack cleanly
- [ ] queue card can live inside shell without regression

## Phase 1: Codex Investigation

Goal:

- identify Codex task-list signal path
- identify Codex live subagent metadata path
- prove we can render both in the rail

Manual validation prompt:

```text
Investigate how provider-backed sessions, plans, and delegated collaborators work in this repo.
Delegate this in parallel.
Use one collaborator to inspect apps/server/src/provider and apps/server/src/orchestration.
Use another collaborator to inspect apps/web/src/components/chat and apps/web/src/components/sidebar.
Return a concise summary with the key files each collaborator read.
Do not make any changes.
```

Validation expectations:

- task list card appears when Codex provides a usable plan
- active subagents card appears when Codex delegates
- subagent rows show name if available, otherwise model, plus prompt excerpt
- clicking a subagent row expands the parent in the sidebar and opens the child thread

Exit gate:

- [ ] Codex event mapping complete
- [ ] Codex task-list card works
- [ ] Codex active-subagents card works
- [ ] Codex manual validation passes

## Phase 2: Codex Polish

Scope:

- ensure worklog still records updates
- prevent duplicate noisy rows
- ensure collapsed-by-default parent behavior is correct

Manual validation prompt:

```text
Inspect thread state flow and delegated work visibility in this repo.
Create a task list, update it while working, and delegate at least two collaborators with distinct prompts.
Return a concise summary of findings.
Do not make any changes.
```

Exit gate:

- [ ] task list updates feel truthful
- [ ] subagent rows feel truthful
- [ ] no duplicate live/worklog confusion remains for Codex

## Codex Lessons From Implementation

These lessons should be treated as hard requirements for OpenCode and Claude rather than rediscovered later.

- Do not assume one Codex task-list shape.
- Codex already produced multiple real checklist formats during validation:
  - `Task list:` with bracketed status tokens like `[in_progress]`
  - `Task list:` with numbered items using prefix status like `Pending:`
  - `Task list:` with plain numbered items plus a follow-up sentence like `I'm on step 1 now`
  - `Task list update:` with suffix status like `...: queued` or `...: in progress`
- So provider normalization must support:
  - heading variants:
    - `Task list:`
    - `Task list update:`
    - future-proof `Todo list:` style aliases where reasonable
  - status placement variants:
    - bracketed
    - prefix
    - suffix
    - implicit active-step prose
- Status normalization must accept common variants, not one exact spelling:
  - `inProgress`
  - `in_progress`
  - `in progress`
  - `queued`
  - `completed`
- Step-text cleanup must strip status tokens even when they arrive wrapped in markdown/backticks.
- Once a task list is promoted into the rail, the same checklist block should be stripped from the visible transcript body so the user does not see the same structure twice.
- The rail should still preserve the non-checklist parts of the assistant message.
- Pending state should be icon-only, not a fully orange row.
- In-progress animation should be slower and calmer than the default spinner.
- Interrupted active work should display as paused if the current task list is still the active one.
- If the agent resumes on the same task list, paused should return to in-progress rather than minting a second duplicate list.
- Shared shell lesson:
  - only the top-most rail card gets rounded top corners
  - the bottom edge stays square into the composer
  - stacked cards above/below should not reintroduce separate silhouettes
- Validation lesson:
  - each parser or display tweak needs the exact user prompt repeated immediately
  - screenshots surfaced multiple real Codex variants that unit tests did not predict upfront
- Implementation lesson for later providers:
  - keep parser/normalization logic in one shared module, not spread across the rail card and transcript renderer
  - keep display-only state such as `paused` layered on top of normalized provider state rather than back-writing it into the parser

## Phase 3: OpenCode Investigation

Goal:

- map OpenCode task-list or planning signals
- map OpenCode subagent metadata
- verify configured agent type/name and model sourcing

Manual validation prompt:

```text
Investigate how orchestration state, sidebar state, and delegated work visibility flow through this repo.
Use parallel subagents.
Have each subagent inspect concrete files and report exact file paths.
Do not make any changes.
```

Validation expectations:

- task list card appears when OpenCode exposes one
- subagent rows show OpenCode agent type/name when known
- model is visible
- prompt excerpt is visible
- clicking a row expands parent and opens the child thread

Exit gate:

- [ ] OpenCode event mapping complete
- [ ] OpenCode task-list card works
- [ ] OpenCode active-subagents card works
- [ ] OpenCode manual validation passes

## Phase 4: OpenCode Polish

Scope:

- handle agent-name fallback rules cleanly
- ensure prompt extraction is reliable across task/delegate variants

Manual validation prompt:

```text
Create a task list for auditing the provider runtime pipeline in this repo.
Delegate to at least three OpenCode subagents with different prompts and at least one named agent type if available.
Return a concise summary with exact files read.
Do not make any changes.
```

Exit gate:

- [ ] OpenCode rail rows are accurate for name/model/prompt
- [ ] no false inheritance from parent agent metadata

## Phase 5: Claude Investigation

Goal:

- identify which Claude signals are structured enough for task-list promotion
- identify child agent/model/prompt metadata path
- define fallback where name is absent

Manual validation prompt:

```text
Review how provider runtime events become visible in the chat UI in this repo.
Create a task list if useful.
Delegate the work to parallel subagents.
Use concrete file inspection and cite exact files in the response.
Do not make any changes.
```

Validation expectations:

- task list card appears only if Claude provides a usable structured list
- subagent rows show at least model + prompt excerpt
- if name is available, show it
- clicking a row expands parent and opens the child thread

Exit gate:

- [ ] Claude event mapping complete
- [ ] Claude task-list card works or is explicitly scoped out for lack of structured signal
- [ ] Claude active-subagents card works
- [ ] Claude manual validation passes

## Phase 6: Claude Polish

Scope:

- improve fallback text quality when agent name is missing
- ensure no misleading parent-agent inheritance

Manual validation prompt:

```text
Inspect provider runtime visibility in this repo.
Maintain or update a task list while delegating multiple Claude subagents with distinct prompts.
Return a concise summary with exact files read.
Do not make any changes.
```

Exit gate:

- [ ] Claude fallback UX is acceptable
- [ ] no misleading metadata remains

## Phase 7: Shared Polish

Scope:

- unify collapse behavior
- unify row truncation rules
- unify status copy
- ensure the rail works with queue + task list + subagents stacked together
- prepare for terminals to adopt the same shell

Exit gate:

- [ ] stacked shell feels coherent
- [ ] task list + queue + subagents can coexist
- [ ] sidebar click-through behavior is correct
- [ ] no regression to child-thread navigation

## Validation Rules

Every provider or sub-phase must satisfy:

- targeted tests pass
- `pnpm typecheck` passes
- `pnpm lint` passes
- manual validation prompt passes
- user feedback is collected before moving to the next provider or sub-phase

## Implementation Constraints

- Do not treat worklog as the primary live surface for plans or subagents anymore.
- Do not auto-expand sidebar parent rows just because children exist.
- Do not hide provider-native metadata if we can surface it honestly.
- Do not invent agent names.
- Prefer blank/omitted name over wrong inherited name.
- Prefer showing model + prompt excerpt over misleading synthetic labels.

## Notes For Future Work

- terminals should eventually migrate into the same live rail shell
- approvals may also belong in the same shell later
- if we later expose background commands or long-running jobs, they should use the same card host instead of inventing a new drawer system
