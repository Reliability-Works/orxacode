import type { ThreadId } from '@orxa-code/contracts'
import { FolderIcon, GitForkIcon } from 'lucide-react'
import { useCallback } from 'react'

import { newCommandId } from '../lib/utils'
import { readNativeApi } from '../nativeApi'
import { useComposerDraftStore, type DraftThreadState } from '../composerDraftStore'
import { useStore } from '../store'
import { useUiStateStore } from '../uiStateStore'
import {
  EnvMode,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from './BranchToolbar.logic'
import { BranchToolbarBranchSelector } from './BranchToolbarBranchSelector'
import { BranchToolbarRepoPicker } from './BranchToolbarRepoPicker'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './ui/select'

const envModeItems = [
  { value: 'local', label: 'Local' },
  { value: 'worktree', label: 'New worktree' },
] as const

interface BranchToolbarProps {
  threadId: ThreadId
  onEnvModeChange: (mode: EnvMode) => void
  envLocked: boolean
  onCheckoutPullRequestRequest?: (reference: string) => void
  onComposerFocusRequest?: () => void
}

function useBranchToolbarDraftState(threadId: ThreadId) {
  const draftThread = useComposerDraftStore(store => store.getDraftThread(threadId))
  const threadEnvModeOverride = useUiStateStore(store => store.threadEnvModeById[threadId] ?? null)
  return { draftThread, threadEnvModeOverride }
}

function findActiveBranchToolbarProject(input: {
  projects: ReturnType<typeof useStore.getState>['projects']
  serverThread: ReturnType<typeof useStore.getState>['threads'][number] | undefined
  draftThread: DraftThreadState | null
}) {
  const activeProjectId = input.serverThread?.projectId ?? input.draftThread?.projectId ?? null
  return input.projects.find(project => project.id === activeProjectId) ?? null
}

function resolveBranchToolbarThreadContext(input: {
  threadId: ThreadId
  serverThread: ReturnType<typeof useStore.getState>['threads'][number] | undefined
  draftThread: DraftThreadState | null
}) {
  const activeWorktreePath =
    input.serverThread?.worktreePath ?? input.draftThread?.worktreePath ?? null
  return {
    activeThreadId: input.serverThread?.id ?? (input.draftThread ? input.threadId : undefined),
    activeThreadBranch: input.serverThread?.branch ?? input.draftThread?.branch ?? null,
    activeWorktreePath,
    hasServerThread: input.serverThread !== undefined,
  }
}

function resolveBranchToolbarState(input: {
  threadId: ThreadId
  threads: ReturnType<typeof useStore.getState>['threads']
  projects: ReturnType<typeof useStore.getState>['projects']
  draftThread: DraftThreadState | null
  threadEnvModeOverride: EnvMode | null
}) {
  const { threadId, threads, projects, draftThread, threadEnvModeOverride } = input
  const serverThread = threads.find(thread => thread.id === threadId)
  const activeProject = findActiveBranchToolbarProject({ projects, serverThread, draftThread })
  const { activeThreadId, activeThreadBranch, activeWorktreePath, hasServerThread } =
    resolveBranchToolbarThreadContext({ threadId, serverThread, draftThread })
  return {
    serverThread,
    activeProject,
    activeThreadId,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd: activeWorktreePath ?? serverThread?.gitRoot ?? activeProject?.cwd ?? null,
    hasServerThread,
    effectiveEnvMode: resolveEffectiveBranchToolbarEnvMode({
      activeWorktreePath,
      draftThreadEnvMode: threadEnvModeOverride ?? draftThread?.envMode,
    }),
  }
}

function useBranchToolbarState(threadId: ThreadId) {
  const threads = useStore(store => store.threads)
  const projects = useStore(store => store.projects)
  const { draftThread, threadEnvModeOverride } = useBranchToolbarDraftState(threadId)
  return resolveBranchToolbarState({
    threadId,
    threads,
    projects,
    draftThread,
    threadEnvModeOverride,
  })
}

function resolveEffectiveBranchToolbarEnvMode(input: {
  activeWorktreePath: string | null
  draftThreadEnvMode: EnvMode | undefined
}): EnvMode {
  return resolveEffectiveEnvMode({
    activeWorktreePath: input.activeWorktreePath,
    draftThreadEnvMode: input.draftThreadEnvMode,
  })
}

function stopRunningThreadSession(
  activeThreadId: ThreadId,
  shouldStop: boolean,
  api: NonNullable<ReturnType<typeof readNativeApi>>
) {
  if (!shouldStop) return
  void api.orchestration
    .dispatchCommand({
      type: 'thread.session.stop',
      commandId: newCommandId(),
      threadId: activeThreadId,
      createdAt: new Date().toISOString(),
    })
    .catch(() => undefined)
}

function createSetThreadBranchAction({
  activeThreadId,
  serverThread,
  activeWorktreePath,
  hasServerThread,
  setThreadBranchAction,
  setDraftThreadContext,
  threadId,
  effectiveEnvMode,
}: {
  activeThreadId: ThreadId | undefined
  serverThread: ReturnType<typeof useBranchToolbarState>['serverThread']
  activeWorktreePath: string | null
  hasServerThread: boolean
  setThreadBranchAction: ReturnType<typeof useStore.getState>['setThreadBranch']
  setDraftThreadContext: ReturnType<typeof useComposerDraftStore.getState>['setDraftThreadContext']
  threadId: ThreadId
  effectiveEnvMode: EnvMode
}) {
  return (branch: string | null, worktreePath: string | null) => {
    if (!activeThreadId) return
    const api = readNativeApi()
    if (api) {
      stopRunningThreadSession(
        activeThreadId,
        Boolean(serverThread?.session && worktreePath !== activeWorktreePath),
        api
      )
    }
    if (api && hasServerThread) {
      void api.orchestration.dispatchCommand({
        type: 'thread.meta.update',
        commandId: newCommandId(),
        threadId: activeThreadId,
        branch,
        worktreePath,
      })
    }
    if (hasServerThread) {
      setThreadBranchAction(activeThreadId, branch, worktreePath)
      return
    }
    setDraftThreadContext(threadId, {
      branch,
      worktreePath,
      envMode: resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      }),
    })
  }
}

function BranchToolbarEnvModeControl({
  envLocked,
  activeWorktreePath,
  effectiveEnvMode,
  onEnvModeChange,
}: {
  envLocked: boolean
  activeWorktreePath: string | null
  effectiveEnvMode: EnvMode
  onEnvModeChange: (mode: EnvMode) => void
}) {
  if (envLocked || activeWorktreePath) {
    return (
      <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
        {activeWorktreePath ? (
          <>
            <GitForkIcon className="size-3" />
            Worktree
          </>
        ) : (
          <>
            <FolderIcon className="size-3" />
            Local
          </>
        )}
      </span>
    )
  }

  return (
    <Select
      value={effectiveEnvMode}
      onValueChange={value => onEnvModeChange(value as EnvMode)}
      items={envModeItems}
    >
      <SelectTrigger variant="ghost" size="xs" className="font-medium">
        {effectiveEnvMode === 'worktree' ? (
          <GitForkIcon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="local">
          <span className="inline-flex items-center gap-1.5">
            <FolderIcon className="size-3" />
            Local
          </span>
        </SelectItem>
        <SelectItem value="worktree">
          <span className="inline-flex items-center gap-1.5">
            <GitForkIcon className="size-3" />
            New worktree
          </span>
        </SelectItem>
      </SelectPopup>
    </Select>
  )
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const setThreadBranchAction = useStore(store => store.setThreadBranch)
  const setDraftThreadContext = useComposerDraftStore(store => store.setDraftThreadContext)
  const {
    serverThread,
    activeProject,
    activeThreadId,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd,
    hasServerThread,
    effectiveEnvMode,
  } = useBranchToolbarState(threadId)

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) =>
      createSetThreadBranchAction({
        activeThreadId,
        serverThread,
        activeWorktreePath,
        hasServerThread,
        setThreadBranchAction,
        setDraftThreadContext,
        threadId,
        effectiveEnvMode,
      })(branch, worktreePath),
    [
      activeThreadId,
      serverThread,
      activeWorktreePath,
      hasServerThread,
      setThreadBranchAction,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ]
  )

  if (!activeThreadId || !activeProject) return null

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pb-3 pt-1">
      <BranchToolbarEnvModeControl
        envLocked={envLocked}
        activeWorktreePath={activeWorktreePath}
        effectiveEnvMode={effectiveEnvMode}
        onEnvModeChange={onEnvModeChange}
      />

      <div className="flex items-center gap-1">
        <BranchToolbarRepoPicker
          threadId={threadId}
          activeProjectCwd={activeProject.cwd}
          activeGitRoot={serverThread?.gitRoot ?? null}
          hasServerThread={hasServerThread}
        />
        <BranchToolbarBranchSelector
          activeProjectCwd={activeProject.cwd}
          activeThreadBranch={activeThreadBranch}
          activeWorktreePath={activeWorktreePath}
          branchCwd={branchCwd}
          effectiveEnvMode={effectiveEnvMode}
          envLocked={envLocked}
          onSetThreadBranch={setThreadBranch}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      </div>
    </div>
  )
}
