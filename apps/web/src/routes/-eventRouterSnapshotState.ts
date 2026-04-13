import { ThreadId } from '@orxa-code/contracts'

import { clearPromotedDraftThreads, useComposerDraftStore } from '../composerDraftStore'
import { collectActiveTerminalThreadIds } from '../lib/terminalStateCleanup'
import { useStore } from '../store'
import { useTerminalStateStore } from '../terminalStateStore'
import { useUiStateStore } from '../uiStateStore'

type UiState = ReturnType<typeof useUiStateStore.getState>
type TerminalState = ReturnType<typeof useTerminalStateStore.getState>

export function syncProjectsFromStore(syncProjects: UiState['syncProjects']) {
  const projects = useStore.getState().projects
  syncProjects(projects.map(project => ({ id: project.id, cwd: project.cwd })))
}

export function syncThreadsFromStore(syncThreads: UiState['syncThreads']) {
  const threads = useStore.getState().threads
  syncThreads(
    threads.map(thread => ({
      id: thread.id,
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    }))
  )
}

export function reconcileSnapshotDerivedState(
  removeOrphanedTerminalStates: TerminalState['removeOrphanedTerminalStates'],
  syncProjects: UiState['syncProjects'],
  syncThreads: UiState['syncThreads']
) {
  const threads = useStore.getState().threads
  syncProjectsFromStore(syncProjects)
  syncThreadsFromStore(syncThreads)
  clearPromotedDraftThreads(threads.map(thread => thread.id))
  const draftThreadIds = Object.keys(
    useComposerDraftStore.getState().draftThreadsByThreadId
  ) as ThreadId[]
  const activeThreadIds = collectActiveTerminalThreadIds({
    snapshotThreads: threads.map(thread => ({ id: thread.id, deletedAt: null })),
    draftThreadIds,
  })
  removeOrphanedTerminalStates(activeThreadIds)
}
