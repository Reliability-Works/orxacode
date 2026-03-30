import type { MutableRefObject } from 'react'
import type { CodexThread } from '@shared/ipc'
import type { CodexThreadRuntimeSnapshot } from '../state/unified-runtime'
import type { SubagentInfo } from './codex-subagent-helpers'
import {
  getResumedActiveTurnId,
  isHiddenSubagentSource,
  normalizeThreadStatusType,
  subagentInfoFromThread,
} from './codex-subagent-helpers'
import { getParentThreadIdFromThread } from './codex-session-notification-helpers'
import { asString } from './codex-session-notification-dispatch'

// ---------------------------------------------------------------------------
// Snapshot comparison helpers
// ---------------------------------------------------------------------------

function isSameCodexThreadSummary(
  left: CodexThread | null | undefined,
  right: CodexThread | null | undefined
) {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return left === right
  }
  return (
    left.id === right.id &&
    left.preview === right.preview &&
    left.modelProvider === right.modelProvider &&
    left.createdAt === right.createdAt &&
    left.ephemeral === right.ephemeral &&
    (left.status?.type ?? '') === (right.status?.type ?? '')
  )
}

export function isSameCodexRuntimeSnapshot(
  left: CodexThreadRuntimeSnapshot | null | undefined,
  right: CodexThreadRuntimeSnapshot | null | undefined
) {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return left === right
  }
  if (!isSameCodexThreadSummary(left.thread, right.thread)) {
    return false
  }
  if (left.childThreads.length !== right.childThreads.length) {
    return false
  }
  return left.childThreads.every((thread, index) =>
    isSameCodexThreadSummary(thread, right.childThreads[index])
  )
}

// ---------------------------------------------------------------------------
// Child thread fetching
// ---------------------------------------------------------------------------

type CodexApi = NonNullable<typeof window.orxa>['codex']

async function fetchChildThreads(
  codex: CodexApi,
  parentThreadId: string,
  runtimeChildThreads: Record<string, unknown>[],
  subagentThreadIds: MutableRefObject<Set<string>>
): Promise<Record<string, unknown>[]> {
  if (
    !codex.listThreads ||
    (runtimeChildThreads.length > 0 &&
      runtimeChildThreads.length >= subagentThreadIds.current.size)
  ) {
    return runtimeChildThreads
  }
  try {
    const listedChildThreads: Record<string, unknown>[] = []
    let cursor: string | null | undefined
    do {
      const page = await codex.listThreads({ cursor, limit: 100, archived: false })
      listedChildThreads.push(
        ...(page.threads ?? [])
          .map(candidate => candidate as unknown as Record<string, unknown>)
          .filter(candidate => {
            const threadId = asString(candidate.id).trim()
            if (
              !threadId ||
              threadId === parentThreadId ||
              isHiddenSubagentSource(candidate.source)
            ) {
              return false
            }
            return (
              getParentThreadIdFromThread(candidate) === parentThreadId ||
              subagentThreadIds.current.has(threadId)
            )
          })
      )
      cursor = page.nextCursor
    } while (cursor)
    if (listedChildThreads.length >= runtimeChildThreads.length) {
      return listedChildThreads
    }
  } catch {
    // Thread list hydration is best-effort only.
  }
  return runtimeChildThreads
}

// ---------------------------------------------------------------------------
// syncCodexThreadRuntime implementation
// ---------------------------------------------------------------------------

export type SyncCodexThreadRuntimeParams = {
  getCurrentCodexRuntime: () => { thread?: CodexThread | null; runtimeSnapshot?: CodexThreadRuntimeSnapshot | null } | null
  activeTurnIdRef: MutableRefObject<string | null>
  pendingInterruptRef: MutableRefObject<boolean>
  interruptRequestedRef: MutableRefObject<boolean>
  subagentThreadIds: MutableRefObject<Set<string>>
  recordLastError: (error: unknown) => void
  setStreamingState: (streaming: boolean) => void
  setSubagentsState: (updater: (previous: SubagentInfo[]) => SubagentInfo[]) => void
  setCodexRuntimeSnapshot: (sessionKey: string, snapshot: CodexThreadRuntimeSnapshot) => void
  sessionKey: string
}

export async function syncCodexThreadRuntimeImpl(params: SyncCodexThreadRuntimeParams) {
  const {
    getCurrentCodexRuntime,
    activeTurnIdRef,
    pendingInterruptRef,
    interruptRequestedRef,
    subagentThreadIds,
    recordLastError,
    setStreamingState,
    setSubagentsState,
    setCodexRuntimeSnapshot,
    sessionKey,
  } = params
  const currentThreadId = getCurrentCodexRuntime()?.thread?.id
  if (!window.orxa?.codex || !currentThreadId) {
    return
  }

  try {
    const codex = window.orxa.codex
    const runtime = await codex.getThreadRuntime(currentThreadId)
    const currentThread = runtime.thread ?? null
    const currentThreadRecord = currentThread
      ? (currentThread as unknown as Record<string, unknown>)
      : null

    if (currentThreadRecord) {
      const resumedTurnId = getResumedActiveTurnId(currentThreadRecord)
      if (resumedTurnId) {
        activeTurnIdRef.current = resumedTurnId
        if (pendingInterruptRef.current || interruptRequestedRef.current) {
          pendingInterruptRef.current = false
          void codex.interruptTurn(currentThreadId, resumedTurnId).catch(error => {
            recordLastError(error)
          })
          return
        }
        setStreamingState(true)
      } else if (
        !pendingInterruptRef.current &&
        normalizeThreadStatusType(currentThreadRecord.status) === 'idle'
      ) {
        activeTurnIdRef.current = null
        interruptRequestedRef.current = false
        setStreamingState(false)
      }
    }

    const parentThreadId = currentThreadId
    const runtimeChildThreads = (runtime.childThreads ?? [])
      .map(candidate => candidate as unknown as Record<string, unknown>)
      .filter(candidate => {
        const threadId = asString(candidate.id).trim()
        return !(!threadId || threadId === parentThreadId || isHiddenSubagentSource(candidate.source))
      })

    const childThreads = await fetchChildThreads(
      codex, parentThreadId, runtimeChildThreads, subagentThreadIds
    )

    const nextRuntimeSnapshot = {
      thread: currentThread ?? null,
      childThreads: childThreads as unknown as CodexThread[],
    }
    const currentRuntimeSnapshot = getCurrentCodexRuntime()?.runtimeSnapshot ?? null
    if (!isSameCodexRuntimeSnapshot(currentRuntimeSnapshot, nextRuntimeSnapshot)) {
      setCodexRuntimeSnapshot(sessionKey, nextRuntimeSnapshot)
    }

    setSubagentsState(previous => {
      if (childThreads.length === 0) {
        return previous
      }
      const previousById = new Map(previous.map(agent => [agent.threadId, agent]))
      const merged = childThreads
        .map((candidate, index) =>
          subagentInfoFromThread(candidate, index, previousById.get(asString(candidate.id).trim()))
        )
        .filter((candidate): candidate is SubagentInfo => candidate !== null)
      const knownIds = new Set(merged.map(agent => agent.threadId))
      const shouldPreserveUnseen =
        Boolean(activeTurnIdRef.current) ||
        normalizeThreadStatusType(currentThreadRecord?.status) === 'active'
      if (shouldPreserveUnseen) {
        previous.forEach(agent => {
          if (!knownIds.has(agent.threadId)) {
            merged.push(agent)
            knownIds.add(agent.threadId)
          }
        })
      }
      subagentThreadIds.current = knownIds
      return merged
    })
  } catch {
    // Polling Codex thread runtime is best-effort only.
  }
}
