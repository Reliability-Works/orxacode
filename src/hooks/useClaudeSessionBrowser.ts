import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClaudeBrowserSessionSummary, ProjectListItem } from '@shared/ipc'

type UseClaudeSessionBrowserArgs = {
  activeProjectDir: string | undefined
  projects: ProjectListItem[]
  setStatusLine: (value: string) => void
  openBoundClaudeSession: (directory: string, sessionID: string, title: string) => Promise<void>
}

function resolveDefaultWorkspaceDirectory(
  activeProjectDir: string | undefined,
  projects: ProjectListItem[]
) {
  if (activeProjectDir && projects.some(project => project.worktree === activeProjectDir)) {
    return activeProjectDir
  }
  return projects[0]?.worktree ?? ''
}

export function useClaudeSessionBrowser({
  activeProjectDir,
  projects,
  setStatusLine,
  openBoundClaudeSession,
}: UseClaudeSessionBrowserArgs) {
  const [isOpen, setIsOpen] = useState(false)
  const [sessions, setSessions] = useState<ClaudeBrowserSessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedWorkspaceDirectory, setSelectedWorkspaceDirectory] = useState(
    resolveDefaultWorkspaceDirectory(activeProjectDir, projects)
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }
    setSelectedWorkspaceDirectory(current => {
      if (current && projects.some(project => project.worktree === current)) {
        return current
      }
      return resolveDefaultWorkspaceDirectory(activeProjectDir, projects)
    })
  }, [activeProjectDir, isOpen, projects])

  const refreshSessions = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await window.orxa.claudeChat.listSessions())
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [setStatusLine])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    void refreshSessions()
  }, [isOpen, refreshSessions])

  const openClaudeSessionBrowser = useCallback(
    (preferredWorkspaceDirectory?: string) => {
      if (preferredWorkspaceDirectory) {
        setSelectedWorkspaceDirectory(preferredWorkspaceDirectory)
      } else {
        setSelectedWorkspaceDirectory(resolveDefaultWorkspaceDirectory(activeProjectDir, projects))
      }
      setIsOpen(true)
    },
    [activeProjectDir, projects]
  )

  const openClaudeBrowserSession = useCallback(
    async (session: ClaudeBrowserSessionSummary) => {
      try {
        if (session.importedSession) {
          await openBoundClaudeSession(
            session.importedSession.directory,
            session.importedSession.sessionID,
            session.title
          )
          setIsOpen(false)
          return
        }
        if (!selectedWorkspaceDirectory) {
          setStatusLine('Choose a workspace before importing a Claude session')
          return
        }
        const resumed = await window.orxa.claudeChat.resumeProviderSession(
          session.providerThreadId,
          selectedWorkspaceDirectory
        )
        await openBoundClaudeSession(resumed.directory, resumed.sessionID, resumed.title)
        setIsOpen(false)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [openBoundClaudeSession, selectedWorkspaceDirectory, setStatusLine]
  )

  const workspaceOptions = useMemo(
    () =>
      projects.map(project => ({
        value: project.worktree,
        label: project.name?.trim() || project.worktree.split('/').pop() || project.worktree,
      })),
    [projects]
  )

  return {
    claudeSessionBrowserOpen: isOpen,
    setClaudeSessionBrowserOpen: setIsOpen,
    claudeBrowserSessions: sessions,
    claudeBrowserSessionsLoading: loading,
    refreshClaudeBrowserSessions: refreshSessions,
    selectedClaudeBrowserWorkspace: selectedWorkspaceDirectory,
    setSelectedClaudeBrowserWorkspace: setSelectedWorkspaceDirectory,
    openClaudeSessionBrowser,
    openClaudeBrowserSession,
    workspaceOptions,
  }
}
