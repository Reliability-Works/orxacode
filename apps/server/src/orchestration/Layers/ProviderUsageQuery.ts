/**
 * ProviderUsageQueryLive - Live implementation of {@link ProviderUsageQuery}.
 *
 * Dispatches to the provider-specific scanner and returns an empty snapshot
 * for providers that have no on-disk logs (e.g. `opencode`). Filesystem
 * errors inside the scanners are already swallowed; this layer promises to
 * never fail so the dashboard panel can render placeholder data without
 * plumbing error state through the UI.
 *
 * @module ProviderUsageQueryLive
 */
import type { ProviderKind, ProviderUsageSnapshot } from '@orxa-code/contracts'
import { Effect, Layer } from 'effect'

import { ProviderUsageQuery, type ProviderUsageQueryShape } from '../Services/ProviderUsageQuery.ts'
import { readClaudeUsage } from './ProviderUsageQuery.claude.ts'
import { readCodexUsage } from './ProviderUsageQuery.codex.ts'

export function emptyProviderUsageSnapshot(provider: ProviderKind): ProviderUsageSnapshot {
  return {
    provider,
    updatedAt: new Date(0).toISOString(),
    totalSessions: 0,
    sessions7d: 0,
    sessions30d: 0,
    modelCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    estimatedCostCents: 0,
    topModels: [],
  }
}

async function loadProviderSnapshot(provider: ProviderKind): Promise<ProviderUsageSnapshot> {
  try {
    if (provider === 'codex') {
      return await readCodexUsage()
    }
    if (provider === 'claudeAgent') {
      return await readClaudeUsage()
    }
    return emptyProviderUsageSnapshot(provider)
  } catch {
    return emptyProviderUsageSnapshot(provider)
  }
}

const makeProviderUsageQuery = Effect.sync(() => {
  const getSnapshot: ProviderUsageQueryShape['getSnapshot'] = ({ provider }) =>
    Effect.promise(() => loadProviderSnapshot(provider))
  return { getSnapshot } satisfies ProviderUsageQueryShape
})

export const ProviderUsageQueryLive = Layer.effect(ProviderUsageQuery, makeProviderUsageQuery)
