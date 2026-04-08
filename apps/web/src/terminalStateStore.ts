/**
 * Single Zustand store for terminal UI state keyed by threadId.
 *
 * Terminal transition helpers are intentionally private to keep the public
 * API constrained to store actions/selectors.
 */

import type { ThreadId } from '@orxa-code/contracts'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { resolveStorage } from './lib/storage'
import {
  createDefaultThreadTerminalState,
  getDefaultThreadTerminalState,
  isDefaultThreadTerminalState,
  type ThreadTerminalState,
  closeThreadTerminal,
  newThreadTerminal,
  setThreadActiveTerminal,
  setThreadTerminalActivity,
  setThreadTerminalHeight,
  setThreadTerminalOpen,
  splitThreadTerminal,
} from './terminalStateStore.logic'

const TERMINAL_STATE_STORAGE_KEY = 'orxa:terminal-state:v1'

function createTerminalStateStorage() {
  return resolveStorage(typeof window !== 'undefined' ? window.localStorage : undefined)
}

export function selectThreadTerminalState(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId
): ThreadTerminalState {
  if (threadId.length === 0) {
    return getDefaultThreadTerminalState()
  }
  return terminalStateByThreadId[threadId] ?? getDefaultThreadTerminalState()
}

function updateTerminalStateByThreadId(
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>,
  threadId: ThreadId,
  updater: (state: ThreadTerminalState) => ThreadTerminalState
): Record<ThreadId, ThreadTerminalState> {
  if (threadId.length === 0) {
    return terminalStateByThreadId
  }

  const current = selectThreadTerminalState(terminalStateByThreadId, threadId)
  const next = updater(current)
  if (next === current) {
    return terminalStateByThreadId
  }

  if (isDefaultThreadTerminalState(next)) {
    if (terminalStateByThreadId[threadId] === undefined) {
      return terminalStateByThreadId
    }
    return Object.fromEntries(
      Object.entries(terminalStateByThreadId).filter(
        ([candidateThreadId]) => candidateThreadId !== threadId
      )
    ) as Record<ThreadId, ThreadTerminalState>
  }

  return {
    ...terminalStateByThreadId,
    [threadId]: next,
  }
}

interface TerminalStateStoreState {
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  setTerminalOpen: (threadId: ThreadId, open: boolean) => void
  setTerminalHeight: (threadId: ThreadId, height: number) => void
  splitTerminal: (threadId: ThreadId, terminalId: string) => void
  newTerminal: (threadId: ThreadId, terminalId: string) => void
  setActiveTerminal: (threadId: ThreadId, terminalId: string) => void
  closeTerminal: (threadId: ThreadId, terminalId: string) => void
  setTerminalActivity: (
    threadId: ThreadId,
    terminalId: string,
    hasRunningSubprocess: boolean
  ) => void
  clearTerminalState: (threadId: ThreadId) => void
  removeTerminalState: (threadId: ThreadId) => void
  removeOrphanedTerminalStates: (activeThreadIds: Set<ThreadId>) => void
}

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    set => {
      const updateTerminal = (
        threadId: ThreadId,
        updater: (state: ThreadTerminalState) => ThreadTerminalState
      ) => {
        set(state => {
          const nextTerminalStateByThreadId = updateTerminalStateByThreadId(
            state.terminalStateByThreadId,
            threadId,
            updater
          )
          if (nextTerminalStateByThreadId === state.terminalStateByThreadId) {
            return state
          }
          return {
            terminalStateByThreadId: nextTerminalStateByThreadId,
          }
        })
      }

      return {
        terminalStateByThreadId: {},
        setTerminalOpen: (threadId, open) =>
          updateTerminal(threadId, state => setThreadTerminalOpen(state, open)),
        setTerminalHeight: (threadId, height) =>
          updateTerminal(threadId, state => setThreadTerminalHeight(state, height)),
        splitTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, state => splitThreadTerminal(state, terminalId)),
        newTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, state => newThreadTerminal(state, terminalId)),
        setActiveTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, state => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, state => closeThreadTerminal(state, terminalId)),
        setTerminalActivity: (threadId, terminalId, hasRunningSubprocess) =>
          updateTerminal(threadId, state =>
            setThreadTerminalActivity(state, terminalId, hasRunningSubprocess)
          ),
        clearTerminalState: threadId =>
          updateTerminal(threadId, () => createDefaultThreadTerminalState()),
        removeTerminalState: threadId =>
          set(state => {
            if (state.terminalStateByThreadId[threadId] === undefined) {
              return state
            }
            const next = { ...state.terminalStateByThreadId }
            delete next[threadId]
            return { terminalStateByThreadId: next }
          }),
        removeOrphanedTerminalStates: activeThreadIds =>
          set(state => {
            const orphanedIds = Object.keys(state.terminalStateByThreadId).filter(
              id => !activeThreadIds.has(id as ThreadId)
            )
            if (orphanedIds.length === 0) return state
            const next = { ...state.terminalStateByThreadId }
            for (const id of orphanedIds) {
              delete next[id as ThreadId]
            }
            return { terminalStateByThreadId: next }
          }),
      }
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createTerminalStateStorage),
      partialize: state => ({
        terminalStateByThreadId: state.terminalStateByThreadId,
      }),
    }
  )
)
