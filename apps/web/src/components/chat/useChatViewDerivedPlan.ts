/**
 * Derives plan sidebar state, proposed plan state, and thread catalog for ChatView.
 */

import { useMemo } from 'react'
import { type ThreadId } from '@orxa-code/contracts'
import { useStore } from '../../store'
import {
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveActivePlanState,
  hasActionableProposedPlan,
} from '../../session-logic'
import { LRUCache } from '../../lib/lruCache'
import type { Thread } from '../../types'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'

type ThreadDerived = ReturnType<typeof useChatViewDerivedThread>
type ActivityDerived = ReturnType<typeof useChatViewDerivedActivities>

type ThreadPlanCatalogEntry = Pick<Thread, 'id' | 'proposedPlans'>

const MAX_ENTRIES = 500
const MAX_MEMORY = 512 * 1024
const planCatalogCache = new LRUCache<{
  proposedPlans: Thread['proposedPlans']
  entry: ThreadPlanCatalogEntry
}>(MAX_ENTRIES, MAX_MEMORY)

function estimateSize(thread: Thread): number {
  return Math.max(
    64,
    thread.id.length +
      thread.proposedPlans.reduce(
        (t, p) =>
          t + p.id.length + p.planMarkdown.length + p.updatedAt.length + (p.turnId?.length ?? 0),
        0
      )
  )
}

function toCatalogEntry(thread: Thread): ThreadPlanCatalogEntry {
  const cached = planCatalogCache.get(thread.id)
  if (cached && cached.proposedPlans === thread.proposedPlans) return cached.entry
  const entry: ThreadPlanCatalogEntry = { id: thread.id, proposedPlans: thread.proposedPlans }
  planCatalogCache.set(
    thread.id,
    { proposedPlans: thread.proposedPlans, entry },
    estimateSize(thread)
  )
  return entry
}

function useThreadPlanCatalog(threadIds: readonly ThreadId[]): ThreadPlanCatalogEntry[] {
  // Select the stable `threads` reference from the store (reducers return the
  // same array when nothing changed). Deriving the catalog in-component via
  // useMemo avoids returning a fresh array from the store selector on every
  // getSnapshot probe, which would otherwise trip useSyncExternalStore's
  // tearing check and cause an infinite render loop.
  const threads = useStore(state => state.threads)
  return useMemo(
    () =>
      threadIds.flatMap(id => {
        const t = threads.find(e => e.id === id)
        return t ? [toCatalogEntry(t)] : []
      }),
    [threadIds, threads]
  )
}

export function useChatViewDerivedPlan(td: ThreadDerived, ad: ActivityDerived) {
  const { activeThread, activeLatestTurn } = td
  const { latestTurnSettled, pendingUserInputs, threadActivities } = ad

  const threadPlanCatalogIds = useMemo(() => {
    const ids: ThreadId[] = []
    if (activeThread?.id) ids.push(activeThread.id)
    const srcId = activeLatestTurn?.sourceProposedPlan?.threadId
    if (srcId && srcId !== activeThread?.id) ids.push(srcId)
    return ids
  }, [activeThread, activeLatestTurn])

  const threadPlanCatalog = useThreadPlanCatalog(threadPlanCatalogIds)

  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) return null
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null
    )
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled])

  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threadPlanCatalog]
  )

  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities]
  )

  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    td.interactionMode === 'plan' &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan)

  return {
    threadPlanCatalog,
    activeProposedPlan,
    sidebarProposedPlan,
    activePlan,
    showPlanFollowUpPrompt,
  }
}
