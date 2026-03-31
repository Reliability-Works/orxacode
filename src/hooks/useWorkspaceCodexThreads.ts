import { useCallback, useEffect, useState } from 'react'
import type { CodexWorkspaceThreadEntry } from '@shared/ipc'

type UseWorkspaceCodexThreadsArgs = {
  modalOpen: boolean
  workspaceRoot: string | undefined
  setStatusLine: (value: string) => void
}

export function useWorkspaceCodexThreads({
  modalOpen,
  workspaceRoot,
  setStatusLine,
}: UseWorkspaceCodexThreadsArgs) {
  const [threads, setThreads] = useState<CodexWorkspaceThreadEntry[]>([])

  const refreshThreads = useCallback(async () => {
    if (!workspaceRoot || !window.orxa?.codex?.listWorkspaceThreads) {
      setThreads([])
      return
    }
    try {
      setThreads(await window.orxa.codex.listWorkspaceThreads(workspaceRoot))
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [setStatusLine, workspaceRoot])

  useEffect(() => {
    if (!modalOpen || !workspaceRoot) {
      return
    }
    void refreshThreads()
  }, [modalOpen, refreshThreads, workspaceRoot])

  return {
    codexThreads: threads,
    refreshCodexThreads: refreshThreads,
  }
}
