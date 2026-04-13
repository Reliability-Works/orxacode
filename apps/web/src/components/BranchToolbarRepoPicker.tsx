import type { ThreadId } from '@orxa-code/contracts'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2Icon } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { gitDiscoverReposQueryOptions } from '../lib/gitReactQuery'
import { newCommandId } from '../lib/utils'
import { readNativeApi } from '../nativeApi'
import { useStore } from '../store'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './ui/select'

interface BranchToolbarRepoPickerProps {
  threadId: ThreadId
  activeProjectCwd: string
  activeGitRoot: string | null
  hasServerThread: boolean
}

function repoDisplayName(repoPath: string, projectCwd: string): string {
  const suffix = repoPath.startsWith(projectCwd)
    ? repoPath.slice(projectCwd.length).replace(/^\//, '')
    : (repoPath.split('/').pop() ?? repoPath)
  return suffix || repoPath
}

export function BranchToolbarRepoPicker({
  threadId,
  activeProjectCwd,
  activeGitRoot,
  hasServerThread,
}: BranchToolbarRepoPickerProps) {
  const { data } = useQuery(gitDiscoverReposQueryOptions(activeProjectCwd))
  const setThreadGitRoot = useStore(store => store.setThreadGitRoot)

  const repos = data?.repos

  const items = useMemo(
    () => (repos ?? []).map(repo => ({ value: repo.path, label: repo.name })),
    [repos]
  )

  const handleChange = useCallback(
    (value: string | null) => {
      const nextGitRoot = value || null
      if (nextGitRoot === activeGitRoot) return
      setThreadGitRoot(threadId, nextGitRoot)
      if (hasServerThread) {
        const api = readNativeApi()
        if (api) {
          void api.orchestration
            .dispatchCommand({
              type: 'thread.meta.update',
              commandId: newCommandId(),
              threadId,
              gitRoot: nextGitRoot,
              branch: null,
              worktreePath: null,
            })
            .catch(() => undefined)
        }
      }
    },
    [threadId, activeGitRoot, hasServerThread, setThreadGitRoot]
  )

  if (items.length < 2) return null

  const currentLabel = activeGitRoot
    ? repoDisplayName(activeGitRoot, activeProjectCwd)
    : 'Select repo'

  return (
    <Select value={activeGitRoot ?? ''} onValueChange={handleChange} items={items}>
      <SelectTrigger variant="ghost" size="xs" className="font-medium text-muted-foreground/70">
        <FolderGit2Icon className="size-3" />
        <SelectValue placeholder={currentLabel}>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {item.label}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}
