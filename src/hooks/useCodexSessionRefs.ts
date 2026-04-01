import { useMemo, useRef } from 'react'
import { getPersistedCodexState } from './codex-session-storage'
import type { CommandDiffBaseline } from './codex-diff-helpers'

export function useCodexSessionRefs(sessionKey: string) {
  const persistedMessageIdCounter = getPersistedCodexState(sessionKey).messageIdCounter
  const activeExploreGroupIdRef = useRef<string | null>(null)
  const activeTurnIdRef = useRef<string | null>(null)
  const codexItemToExploreGroupIdRef = useRef(new Map<string, string>())
  const codexItemToMsgIdRef = useRef(new Map<string, string>())
  const commandDiffPollTimersRef = useRef(new Map<string, number>())
  const commandDiffSnapshotsRef = useRef(new Map<string, Promise<CommandDiffBaseline | null>>())
  const currentReasoningIdRef = useRef<string | null>(null)
  const interruptRequestedRef = useRef(false)
  const itemThreadIdsRef = useRef(new Map<string, string>())
  const latestPlanUpdateIdRef = useRef<string | null>(null)
  const messageIdCounterRef = useRef(persistedMessageIdCounter)
  const pendingInterruptRef = useRef(false)
  const streamingItemIdRef = useRef<string | null>(null)
  const subagentThreadIdsRef = useRef(new Set<string>())
  const thinkingItemIdRef = useRef<string | null>(null)
  const turnThreadIdsRef = useRef(new Map<string, string>())

  return useMemo(
    () => ({
      activeExploreGroupIdRef,
      activeTurnIdRef,
      codexItemToExploreGroupIdRef,
      codexItemToMsgIdRef,
      commandDiffPollTimersRef,
      commandDiffSnapshotsRef,
      currentReasoningIdRef,
      interruptRequestedRef,
      itemThreadIdsRef,
      latestPlanUpdateIdRef,
      messageIdCounterRef,
      pendingInterruptRef,
      streamingItemIdRef,
      subagentThreadIdsRef,
      thinkingItemIdRef,
      turnThreadIdsRef,
    }),
    []
  )
}
