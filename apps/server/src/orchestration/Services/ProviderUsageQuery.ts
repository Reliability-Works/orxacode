/**
 * ProviderUsageQuery - Per-provider usage snapshot for the dashboard panels.
 *
 * Scans on-disk provider session logs (`~/.codex/sessions`, `~/.claude/projects`)
 * to compute token counts, estimated cost, and top models. The data lives on
 * the user's machine rather than in the server projection tables, so this query
 * reads the filesystem directly — but it runs on the server so both web and
 * Electron clients can reach it via a single WS RPC.
 *
 * @module ProviderUsageQuery
 */
import type { ProviderKind, ProviderUsageSnapshot } from '@orxa-code/contracts'
import { ServiceMap } from 'effect'
import type { Effect } from 'effect'

export interface ProviderUsageQueryShape {
  readonly getSnapshot: (input: {
    readonly provider: ProviderKind
  }) => Effect.Effect<ProviderUsageSnapshot, never>
}

export class ProviderUsageQuery extends ServiceMap.Service<
  ProviderUsageQuery,
  ProviderUsageQueryShape
>()('orxacode/orchestration/Services/ProviderUsageQuery') {}
