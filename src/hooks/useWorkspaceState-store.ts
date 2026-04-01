import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import type { SessionMessageBundle } from '@shared/ipc'
import type { ProjectBootstrap } from '@shared/ipc'

export function useWorkspaceStateStore() {
  const activeProjectDir = useUnifiedRuntimeStore(state => state.activeWorkspaceDirectory)
  const setActiveProjectDir = useUnifiedRuntimeStore(state => state.setActiveWorkspaceDirectory)
  const activeSessionID = useUnifiedRuntimeStore(state => state.activeSessionID)
  const setActiveSession = useUnifiedRuntimeStore(state => state.setActiveSession)
  const pendingSessionId = useUnifiedRuntimeStore(state => state.pendingSessionId)
  const setPendingSessionId = useUnifiedRuntimeStore(state => state.setPendingSessionId)
  const projectData = useUnifiedRuntimeStore(state =>
    activeProjectDir ? (state.projectDataByDirectory[activeProjectDir] ?? null) : null
  )
  const setProjectDataForDirectory = useUnifiedRuntimeStore(state => state.setProjectData)
  const removeOpencodeSession = useUnifiedRuntimeStore(state => state.removeOpencodeSession)
  const setWorkspaceMeta = useUnifiedRuntimeStore(state => state.setWorkspaceMeta)
  const setOpencodeMessages = useUnifiedRuntimeStore(state => state.setOpencodeMessages)
  const setOpencodeRuntimeSnapshot = useUnifiedRuntimeStore(
    state => state.setOpencodeRuntimeSnapshot
  )
  const setOpencodeTodoItems = useUnifiedRuntimeStore(state => state.setOpencodeTodoItems)
  const collapsedProjects = useUnifiedRuntimeStore(state => state.collapsedProjects)
  const replaceCollapsedProjects = useUnifiedRuntimeStore(state => state.replaceCollapsedProjects)

  return {
    activeProjectDir,
    setActiveProjectDir,
    activeSessionID,
    setActiveSession,
    pendingSessionId,
    setPendingSessionId,
    projectData,
    setProjectDataForDirectory,
    removeOpencodeSession,
    setWorkspaceMeta,
    setOpencodeMessages,
    setOpencodeRuntimeSnapshot,
    setOpencodeTodoItems,
    collapsedProjects,
    replaceCollapsedProjects,
  }
}

export type UnifiedRuntimeState = ReturnType<typeof useUnifiedRuntimeStore.getState>
export type SetProjectData = (next: ProjectBootstrap | null) => void
export type SetMessages = (next: SessionMessageBundle[]) => void
