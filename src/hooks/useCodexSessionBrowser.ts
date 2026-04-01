import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CodexBrowserThreadSummary, ProjectListItem } from '@shared/ipc'

type UseCodexSessionBrowserArgs = {
  activeProjectDir: string | undefined
  projects: ProjectListItem[]
  setStatusLine: (value: string) => void
  openBoundCodexSession: (directory: string, sessionID: string, title: string) => Promise<void>
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

export function useCodexSessionBrowser({
  activeProjectDir,
  projects,
  setStatusLine,
  openBoundCodexSession,
}: UseCodexSessionBrowserArgs) {
  const [isOpen, setIsOpen] = useState(false)
  const [threads, setThreads] = useState<CodexBrowserThreadSummary[]>([])
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

  const refreshThreads = useCallback(async () => {
    setLoading(true)
    try {
      setThreads(await window.orxa.codex.listBrowserThreads())
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
    void refreshThreads()
  }, [isOpen, refreshThreads])

  const openCodexSessionBrowser = useCallback(
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

  const openCodexBrowserThread = useCallback(
    async (thread: CodexBrowserThreadSummary) => {
      try {
        if (thread.importedSession) {
          await openBoundCodexSession(
            thread.importedSession.directory,
            thread.importedSession.sessionID,
            thread.title
          )
          setIsOpen(false)
          return
        }
        if (!selectedWorkspaceDirectory) {
          setStatusLine('Choose a workspace before importing a Codex thread')
          return
        }
        const resumed = await window.orxa.codex.resumeProviderThread(
          thread.threadId,
          selectedWorkspaceDirectory
        )
        await openBoundCodexSession(resumed.directory, resumed.sessionID, resumed.title)
        setIsOpen(false)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [openBoundCodexSession, selectedWorkspaceDirectory, setStatusLine]
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
    codexSessionBrowserOpen: isOpen,
    setCodexSessionBrowserOpen: setIsOpen,
    codexBrowserThreads: threads,
    codexBrowserThreadsLoading: loading,
    refreshCodexBrowserThreads: refreshThreads,
    selectedCodexBrowserWorkspace: selectedWorkspaceDirectory,
    setSelectedCodexBrowserWorkspace: setSelectedWorkspaceDirectory,
    openCodexSessionBrowser,
    openCodexBrowserThread,
    workspaceOptions,
  }
}
