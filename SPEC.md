# Orxa Performance + Stability Spec

**Updated:** 2026-04-02

This spec captures the complete performance/stability effort to date, organized into phases with explicit completion status.

## Phase 0 — Problem Definition + Success Criteria

- [x] Confirm top user pain points:
  - startup crashes / repeated startup re-entry
  - startup flicker / slow initial responsiveness
  - missing sidebar footer actions
  - debug/workspace UI usability friction
  - performance exports too noisy to diagnose issues
- [x] Define success criteria:
  - stable startup (no callback-loop re-entry)
  - restored utility surfaces
  - actionable performance exports (focused, filterable)
  - architectural guardrails to prevent regressions

## Phase 1 — Startup Stability + Core UX Recovery

- [x] Fix startup loop root cause in `useAppShellStartupFlow` (callback identity re-trigger).
- [x] Add startup regression test for callback identity changes.
- [x] Harden renderer event publish/send path against disposed/crashed frame races.
- [x] Add publisher tests for disposed-frame handling.
- [x] Restore sidebar footer actions:
  - Check for updates
  - Settings
  - Debug

## Phase 2 — Debug Surface + Workspace Details Improvements

- [x] Split Debug into tabs (Dashboard vs Logs) to remove overlap/clutter.
- [x] Increase glass-theme opacity for better readability and polish.
- [x] Improve Workspace Details visual hierarchy.
- [x] Replace glitchy “Loading worktrees…” behavior with inline skeleton loading.

## Phase 3 — Performance Export Usability (High-Signal by Default)

- [x] Add export controls and filter contract across shared IPC, preload, handlers, and service.
- [x] Support filtering knobs:
  - `sinceMs`
  - `summaryLimit`
  - `includeEvents`
  - `eventLimit`
  - `includeInternalTelemetry`
- [x] Make focused defaults the standard path:
  - last 30 minutes
  - bounded summaries/events
  - internal telemetry excluded
- [x] Include export metadata (`filter`, `eventStats`) for interpretability.
- [x] Improve capped-event selection to prioritize high-value slow-path events.
- [x] Add range presets in the debug UI.

## Phase 4 — Architecture-Level Perf Hardening

- [x] Add preload-level in-flight dedupe and in-flight telemetry (`ipc.inflight_count`).
- [x] Add runtime snapshot in-memory dedupe/cache reuse window.
- [x] Coalesce/throttle background resume refresh in `App.core.tsx`.
- [x] Reduce aggressive live-sync polling; move toward one-shot reconcile behavior.
- [x] Add lightweight delta refresh endpoint:
  - IPC channel: `opencodeRefreshProjectDelta`
  - typed payload: `ProjectRefreshDelta`
  - service method and metric: `opencode.refresh_project_delta_ms`
  - handler + preload bridge wiring
- [x] Route high-frequency refresh path to delta when cached project data exists.
- [x] Merge delta responses into cached project state (`commitProjectDelta`).
- [x] Add per-project single-flight + cooldown protections for background churn.

## Phase 5 — Regression Prevention + Policy + Automation

- [x] Add performance sync guardrails to root `AGENTS.md`.
- [x] Add `test:perf-guard` script.
- [x] Wire `test:perf-guard` into `.husky/pre-commit`.
- [x] Wire `test:perf-guard` into CI workflow.
- [x] Add/extend focused regression tests:
  - live-sync polling behavior
  - preload delta dedupe
  - opencode delta runtime handler/service path

## Phase 6 — Cross-Repo Comparison (orxacode vs t3code)

- [x] Complete architect analysis of `../t3code`.
- [x] Document key patterns to emulate and why they matter.
- [x] Convert findings into phased adoption guidance for Orxa.

### Phase 6.1 — Bottom line (extracted)

- [x] `t3code` feels faster because it is **stream-first**, **server-authoritative**, and **selector-driven**.
- [x] `orxacode` already has dedupe/coalescing improvements, but still pays extra cost from:
  - poll/reconcile behavior in active paths,
  - heavier refresh payloads than necessary,
  - broad store subscriptions causing render fanout.

### Phase 6.2 — What `t3code` does better (useful context)

1. **Server-authoritative stream + replay recovery**
   - Replays missed events, enforces sequence continuity, falls back to snapshot only on replay failure.
   - Why it matters: low-latency first/ongoing output without steady-state polling.
2. **Lean read-model boundary**
   - Session/orchestration hot path carries focused state; ancillary metadata is fetched separately.
   - Why it matters: less payload weight and less hot-path contention.
3. **Persistent transport model**
   - One long-lived transport/client rather than many ad-hoc request hops.
   - Why it matters: lower per-interaction overhead and warmer first token path.
4. **Batched reducer commits + narrow selectors**
   - Event batches are applied in one store mutation; per-slice selectors reduce re-render spread.
   - Why it matters: better typing/scroll smoothness under stream load.
5. **Virtualized timeline render path**
   - Large message histories avoid full-list render cost on each active update.
   - Why it matters: long sessions stay responsive.

### Phase 6.3 — 1:1 gap map in `orxacode` (useful context)

1. **Stream trust gap**
   - Active session behavior still has poll/reconcile and post-send refreshes in key paths.
   - Effect: extra first-response and ongoing stream latency.
2. **Payload boundary gap**
   - `refreshProject()` and `getSessionRuntime()` still bundle cold metadata with hot data in several flows.
   - Effect: more IPC bytes, main-process work, and queue pressure.
3. **Transport gap**
   - Many hot paths still use invoke-style crossings preload → main → service.
   - Effect: higher invoke RTT pressure vs long-lived stream channel.
4. **Selector/subscription gap**
   - Some app-shell/session surfaces still subscribe to broad maps.
   - Effect: active updates fan out into unnecessary recomputation.
5. **Virtualization/render-path gap**
   - Message panes can still run non-virtualized paths and expensive derivation under load.
   - Effect: long-session commit/scroll/typing degradation.

### Phase 6.4 — Watch-outs from review

- [x] Event ordering + replay correctness must remain the top invariant.
- [x] Hot/cold payload split may expose hidden dependencies on oversized current responses.
- [x] Virtualization must preserve scroll anchoring, tail behavior, and inline expansion semantics.

## Phase 7 — Remaining High-Impact Work

This phase is now directly based on the `t3code` review recommendations (A–H), plus Orxa-specific guard/telemetry extras.

### Phase 7A — Quick wins (1–2 days)

- [x] **A. Remove redundant post-send/post-event refreshes**
  - Remove immediate `refreshMessages()` / `refreshProject()` follow-ups where stream events are authoritative.
  - Keep explicit fallback refresh only for event types not fully represented in stream state.
  - Validate with:
    - `prompt.first_event_ms`
    - `prompt.first_assistant_output_ms`
    - `background.poll_count`
    - `workspace.refresh_ms`
- [x] **B. Expand invoke coalescing/dedupe coverage**
  - Extend preload dedupe/coalescing for repeated resume/selection/send follow-up invokes.
  - Validate with:
    - `ipc.inflight_count` p95
    - `ipc.invoke_rtt_ms` by channel
    - payload-size buckets by channel
- [x] **C. Enable virtualization for long timelines first**
  - Start with `MessageFeed` thresholded virtualization for long sessions.
  - Validate with:
    - `render.commit_ms`
    - `render.slow_commit_count`
    - `renderer.longtask_ms`
- [x] **A-follow-up. Remove remaining post-reply project refreshes in awaiting-input handlers**
  - `replyPermission` / `replyQuestion` / `rejectQuestion` still force `refreshProject()` despite stream support for `permission.replied` and `question.replied`/`question.rejected`.
  - Completed for manual and yolo auto-reply paths; handlers now rely on stream-state updates instead of immediate refresh.

### Phase 7B — Medium refactor (3–5 days)

- [x] **D. Split hot-path vs cold-path payloads**
  - `refreshProject`: hot (sessions/status/questions/permissions/commands) vs cold (providers/agents/config/MCP/LSP/formatter/VCS/path).
  - `getSessionRuntime`: core runtime vs lazy extras (diff/ledger/provenance).
  - Progress:
    - [x] Add core runtime path (`getSessionRuntimeCore`) and lazy extras hydration (`loadSessionDiff` / ledger / provenance) in renderer sync flow.
    - [x] Complete `refreshProject` hot/cold split so cold metadata can be fetched on-demand.
  - Note: full `refreshProject` remains available for bootstrap/compatibility; active refresh loops now use hot delta + cold on-demand hydration.
  - Validate with:
    - `opencode.refresh_project_ms`
    - `opencode.refresh_project_delta_ms`
    - `opencode.get_session_runtime_ms`
    - `ipc.invoke_rtt_ms`
    - payload-size buckets per endpoint
- [x] **E. Batch-oriented renderer reducer commits for stream events**
  - Accumulate short event bursts and commit one store mutation per flush.
  - Implemented: queue microtask batching in workspace stream event handler with per-flush single Zustand mutation + telemetry (`event.batch.size`, `event.batch.flush_ms`).
  - Validate with:
    - `render.commit_count`
    - `render.commit_burst_count`
    - `event.batch.size`
    - `event.batch.flush_ms`
- [x] **E-follow-up. Add max-batch safeguard under sustained event storms**
  - Added bounded batch size (`100`) with macrotask-yielded continuation for queued overflow to keep long bursts from monopolizing the renderer.
- [x] **F. Replace whole-map subscriptions with narrow selectors**
  - Refactor app shell/session collection hooks to per-project/per-session slices.
  - Implemented:
    - Session collection hook now tracks only visible sidebar sessions and subscribes via derived presentation signal instead of full runtime maps.
    - Active session status now subscribes to an active-session signal instead of full per-provider session maps.
  - Validate with:
    - component-level render metrics (app shell/sidebar/composer)
    - typing latency traces
- [x] **F-follow-up. Push remaining App shell map reads behind scoped selectors**
  - `App.core` now consumes scoped, equality-checked subsets for project cache and workspace shell maps instead of subscribing to full `projectDataByDirectory` / `workspace*` maps.
  - Session search payload derivation now reuses `cachedSessionsByProject` from session-collection surfaces instead of rebuilding from the full project map.

### Phase 7C — Deeper architecture (1–2 weeks)

- [ ] **G. Sequence-based stream + replay model for opencode session UX**
  - Per-session/per-workspace cursor.
  - Replay missed deltas first; snapshot fallback only on replay failure.
  - Validate with:
    - `prompt.first_event_ms`
    - `prompt.first_assistant_output_ms`
    - `prompt.complete_ms`
    - `background.workspace_refresh_ms`
    - `background.poll_count` trend toward zero on active sessions
- [ ] **H. Long-lived session transport across Electron boundary**
  - Move away from invoke-heavy reconcile loops in hot session paths.
  - Include lifecycle, cleanup, replay, and backpressure handling.
  - Validate with:
    - `ipc.inflight_count`
    - `ipc.invoke_rtt_ms` p95
    - dropped/recovered stream counters
    - renderer long-task rate under active stream load

### Phase 7D — Orxa-specific extras (added)

- [ ] Add explicit AGENTS/lint/test guardrails for banned anti-patterns:
  1. no polling for active output when stream exists,
  2. no full bootstrap in resume/poll paths when delta/replay exists,
  3. no whole-map subscriptions in render-critical surfaces.
- [ ] Add CI-visible payload-size telemetry buckets for `refreshProject`, `refreshProjectDelta`, and `getSessionRuntime`.
- [ ] Add canary perf review cadence (export snapshot before/after each Phase 7 subphase).

## Validation Status (Current)

- [x] `pnpm test:perf-guard`
- [x] targeted tests for touched runtime/sync paths
- [x] `pnpm typecheck`
- [x] `pnpm lint` (warnings only; no new errors)

## Out of Scope for This Performance Initiative

- [x] Large redesigns not tied to responsiveness/perceived speed.
- [x] Broad feature work unrelated to startup, sync loops, or diagnostics quality.
