import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceWorktree } from '@shared/ipc'
import type { SessionType } from '../types/canvas'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

type UseWorkspaceWorktreesArgs = {
  workspaceDir: string | undefined
  createSession: (directory?: string, sessionTypeOrPrompt?: SessionType | string) => Promise<unknown>
  setStatusLine: (value: string) => void
}

function pickPreferredWorktree(
  worktrees: WorkspaceWorktree[],
  currentSelection: string | undefined
) {
  if (currentSelection && worktrees.some(entry => entry.directory === currentSelection)) {
    return currentSelection
  }
  return worktrees.find(entry => !entry.isMain)?.directory ?? worktrees[0]?.directory ?? ''
}

function useWorkspaceWorktreeActions({
  workspaceRoot,
  createSession,
  setStatusLine,
  setWorkspaceRootForDirectory,
  setSelectedWorkspaceWorktree,
  setWorkspaceWorktrees,
  worktreesByWorkspace,
}: Pick<UseWorkspaceWorktreesArgs, 'createSession' | 'setStatusLine'> & {
  workspaceRoot: string | undefined
  setWorkspaceRootForDirectory: (directory: string, workspaceRoot?: string) => void
  setSelectedWorkspaceWorktree: (workspaceRoot: string, directory?: string) => void
  setWorkspaceWorktrees: (workspaceRoot: string, worktrees: WorkspaceWorktree[]) => void
  worktreesByWorkspace: Record<string, WorkspaceWorktree[]>
}) {
  const createWorktree = useCallback(
    async (name: string) => {
      if (!workspaceRoot) {
        return
      }
      try {
        const worktree = await window.orxa.worktrees.create({ workspaceDir: workspaceRoot, name })
        const next = [...(worktreesByWorkspace[workspaceRoot] ?? []), worktree].sort((left, right) =>
          left.directory.localeCompare(right.directory)
        )
        setWorkspaceWorktrees(workspaceRoot, next)
        setWorkspaceRootForDirectory(worktree.directory, workspaceRoot)
        setSelectedWorkspaceWorktree(workspaceRoot, worktree.directory)
        setStatusLine(`Worktree created: ${worktree.name}`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      setStatusLine,
      setSelectedWorkspaceWorktree,
      setWorkspaceRootForDirectory,
      setWorkspaceWorktrees,
      worktreesByWorkspace,
      workspaceRoot,
    ]
  )

  const openWorktree = useCallback(
    async (directory: string) => {
      try {
        await window.orxa.worktrees.open(directory, 'zed')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [setStatusLine]
  )

  const launchSessionInWorktree = useCallback(
    async (directory: string, sessionType: SessionType) => {
      try {
        if (workspaceRoot) {
          setWorkspaceRootForDirectory(directory, workspaceRoot)
        }
        await createSession(directory, sessionType)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [createSession, setStatusLine, setWorkspaceRootForDirectory, workspaceRoot]
  )

  return { createWorktree, openWorktree, launchSessionInWorktree }
}

function useDeleteWorktreeAction({
  workspaceRoot,
  setStatusLine,
  setWorkspaceRootForDirectory,
  worktreesByWorkspace,
  setSelectedWorkspaceWorktree,
  setWorkspaceWorktrees,
}: Pick<UseWorkspaceWorktreesArgs, 'setStatusLine'> & {
  workspaceRoot: string | undefined
  setWorkspaceRootForDirectory: (directory: string, workspaceRoot?: string) => void
  worktreesByWorkspace: Record<string, WorkspaceWorktree[]>
  setSelectedWorkspaceWorktree: (workspaceRoot: string, directory?: string) => void
  setWorkspaceWorktrees: (workspaceRoot: string, worktrees: WorkspaceWorktree[]) => void
}) {
  return useCallback(
    async (directory: string) => {
      if (!workspaceRoot) {
        return
      }
      try {
        await window.orxa.worktrees.delete(workspaceRoot, directory)
        const remaining = (worktreesByWorkspace[workspaceRoot] ?? []).filter(
          entry => entry.directory !== directory
        )
        setWorkspaceWorktrees(workspaceRoot, remaining)
        setWorkspaceRootForDirectory(directory, undefined)
        const nextSelection = pickPreferredWorktree(remaining, undefined)
        setSelectedWorkspaceWorktree(workspaceRoot, nextSelection || undefined)
        setStatusLine('Worktree removed')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      setStatusLine,
      setSelectedWorkspaceWorktree,
      setWorkspaceRootForDirectory,
      setWorkspaceWorktrees,
      workspaceRoot,
      worktreesByWorkspace,
    ]
  )
}

export function useWorkspaceWorktrees({
  workspaceDir,
  createSession,
  setStatusLine,
}: UseWorkspaceWorktreesArgs) {
  const workspaceRoot = useUnifiedRuntimeStore(state =>
    workspaceDir ? (state.workspaceRootByDirectory[workspaceDir] ?? workspaceDir) : undefined
  )
  const replaceWorkspaceDirectoryAssociations = useUnifiedRuntimeStore(
    state => state.replaceWorkspaceDirectoryAssociations
  )
  const setWorkspaceRootForDirectory = useUnifiedRuntimeStore(
    state => state.setWorkspaceRootForDirectory
  )
  const worktreesByWorkspace = useUnifiedRuntimeStore(state => state.worktreesByWorkspace)
  const selectedWorktreeByWorkspace = useUnifiedRuntimeStore(
    state => state.selectedWorktreeByWorkspace
  )
  const setWorkspaceWorktrees = useUnifiedRuntimeStore(state => state.setWorkspaceWorktrees)
  const setSelectedWorkspaceWorktree = useUnifiedRuntimeStore(
    state => state.setSelectedWorkspaceWorktree
  )
  const [loadingByWorkspace, setLoadingByWorkspace] = useState<Record<string, boolean>>({})

  const loadWorktrees = useCallback(
    async (targetWorkspace: string) => {
      setLoadingByWorkspace(current => ({ ...current, [targetWorkspace]: true }))
      try {
        const worktrees = await window.orxa.worktrees.list(targetWorkspace)
        setWorkspaceWorktrees(targetWorkspace, worktrees)
        replaceWorkspaceDirectoryAssociations(
          targetWorkspace,
          Array.from(new Set([targetWorkspace, ...worktrees.map(entry => entry.directory)]))
        )
        const preferred = pickPreferredWorktree(worktrees, selectedWorktreeByWorkspace[targetWorkspace])
        setSelectedWorkspaceWorktree(targetWorkspace, preferred || undefined)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      } finally {
        setLoadingByWorkspace(current => ({ ...current, [targetWorkspace]: false }))
      }
    },
    [
      replaceWorkspaceDirectoryAssociations,
      selectedWorktreeByWorkspace,
      setSelectedWorkspaceWorktree,
      setStatusLine,
      setWorkspaceWorktrees,
    ]
  )

  useEffect(() => {
    if (!workspaceRoot) {
      return
    }
    void loadWorktrees(workspaceRoot)
  }, [loadWorktrees, workspaceRoot])

  const { createWorktree, openWorktree, launchSessionInWorktree } =
    useWorkspaceWorktreeActions({
      workspaceRoot,
      createSession,
      setStatusLine,
      setWorkspaceRootForDirectory,
      setSelectedWorkspaceWorktree,
      setWorkspaceWorktrees,
      worktreesByWorkspace,
    })
  const deleteWorktree = useDeleteWorktreeAction({
    workspaceRoot,
    setStatusLine,
    setWorkspaceRootForDirectory,
    worktreesByWorkspace,
    setSelectedWorkspaceWorktree,
    setWorkspaceWorktrees,
  })

  const worktrees = useMemo(
    () => (workspaceRoot ? worktreesByWorkspace[workspaceRoot] ?? [] : []),
    [workspaceRoot, worktreesByWorkspace]
  )

  return {
    worktrees,
    workspaceRoot,
    worktreesLoading: workspaceRoot ? loadingByWorkspace[workspaceRoot] ?? false : false,
    selectedWorktreeDirectory: workspaceRoot ? selectedWorktreeByWorkspace[workspaceRoot] ?? '' : '',
    setSelectedWorktreeDirectory: (directory: string) => {
      if (!workspaceRoot) {
        return
      }
      setSelectedWorkspaceWorktree(workspaceRoot, directory)
    },
    refreshWorktrees: () => (workspaceRoot ? loadWorktrees(workspaceRoot) : Promise.resolve()),
    createWorktree,
    openWorktree,
    deleteWorktree,
    launchSessionInWorktree,
  }
}
