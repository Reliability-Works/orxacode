import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { openBoundLocalProviderSessionAction } from '../app-core-session'
import type { SessionType } from '../types/canvas'

type UseBoundProviderSessionOpenersArgs = {
  activeProjectDir: string | undefined
  clearPendingSession: () => void
  markSessionUsed: (sessionID: string) => void
  registerSyntheticSession: Parameters<typeof openBoundLocalProviderSessionAction>[0]['registerLocalProviderSession']
  selectProject: (directory: string) => Promise<void>
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setManualSessionTitles: Dispatch<SetStateAction<Record<string, boolean>>>
  setSessionTitles: Dispatch<SetStateAction<Record<string, string>>>
  setSessionTypes: Dispatch<SetStateAction<Record<string, SessionType>>>
  setSidebarMode: (mode: 'projects' | 'kanban' | 'skills') => void
  setStatusLine: (value: string) => void
}

export function useBoundProviderSessionOpeners({
  activeProjectDir,
  clearPendingSession,
  markSessionUsed,
  registerSyntheticSession,
  selectProject,
  setActiveProjectDir,
  setActiveSessionID,
  setManualSessionTitles,
  setSessionTitles,
  setSessionTypes,
  setSidebarMode,
  setStatusLine,
}: UseBoundProviderSessionOpenersArgs) {
  const openBoundProviderSession = useCallback(
    async (
      directory: string,
      sessionID: string,
      sessionType: 'claude-chat' | 'codex',
      title?: string
    ) =>
      openBoundLocalProviderSessionAction(
        {
          activeProjectDir,
          clearPendingSession,
          markSessionUsed,
          registerLocalProviderSession: registerSyntheticSession,
          selectProject,
          setActiveProjectDir,
          setActiveSessionID,
          setManualSessionTitles,
          setSessionTitles,
          setSessionTypes,
          setSidebarMode,
          setStatusLine,
        },
        {
          directory,
          sessionID,
          sessionType,
          title: title ?? (sessionType === 'codex' ? 'Recovered Codex Thread' : 'Claude Code (Chat)'),
        }
      ),
    [
      activeProjectDir,
      clearPendingSession,
      markSessionUsed,
      registerSyntheticSession,
      selectProject,
      setActiveProjectDir,
      setActiveSessionID,
      setManualSessionTitles,
      setSessionTitles,
      setSessionTypes,
      setSidebarMode,
      setStatusLine,
    ]
  )

  const openBoundClaudeSession = useCallback(
    (directory: string, sessionID: string, title?: string) =>
      openBoundProviderSession(
        directory,
        sessionID,
        'claude-chat',
        title?.trim() || 'Claude Code (Chat)'
      ),
    [openBoundProviderSession]
  )

  const openBoundCodexSession = useCallback(
    (directory: string, sessionID: string, title?: string) =>
      openBoundProviderSession(
        directory,
        sessionID,
        'codex',
        title?.trim() || 'Recovered Codex Thread'
      ),
    [openBoundProviderSession]
  )

  return {
    openBoundClaudeSession,
    openBoundCodexSession,
  }
}
