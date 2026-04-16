import type { ThreadId } from '@orxa-code/contracts'
import {
  FocusIcon,
  FolderGit2Icon,
  FolderIcon,
  MinimizeIcon,
  TerminalSquareIcon,
} from 'lucide-react'
import { useCallback } from 'react'

import { useZenMode } from '../hooks/useZenMode'
import type { ContextWindowSnapshot } from '~/lib/contextWindow'
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
import { ContextWindowMeter } from './chat/ContextWindowMeter'
import { Button } from './ui/button'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './ui/select'
import { Toggle } from './ui/toggle'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'

const envModeItems = [
  { value: 'local', label: 'Local' },
  { value: 'worktree', label: 'New worktree' },
] as const

interface BranchToolbarProps {
  threadId: ThreadId
  onEnvModeChange: (mode: EnvMode) => void
  envLocked: boolean
  contextWindow?: ContextWindowSnapshot | null
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  onToggleTerminal: () => void
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

function BranchToolbarZenToggle() {
  const zen = useZenMode()
  const label = zen.enabled ? 'Exit zen mode' : 'Enter zen mode'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => zen.toggleZen()}
            aria-label={label}
            className="shrink-0 gap-1.5 text-muted-foreground"
          >
            {zen.enabled ? (
              <>
                <MinimizeIcon className="size-3.5" />
                Unzen
              </>
            ) : (
              <FocusIcon className="size-3.5" />
            )}
          </Button>
        }
      />
      <TooltipPopup side="top">{label} (⇧⌘Z)</TooltipPopup>
    </Tooltip>
  )
}

function BranchToolbarTerminalToggle(props: {
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  onToggleTerminal: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 border-transparent text-muted-foreground"
            pressed={props.terminalOpen}
            onPressedChange={props.onToggleTerminal}
            aria-label={props.terminalToggleLabel}
            size="xs"
            disabled={!props.terminalAvailable}
          >
            <TerminalSquareIcon className="size-3.5" />
          </Toggle>
        }
      />
      <TooltipPopup side="top">{props.terminalToggleLabel}</TooltipPopup>
    </Tooltip>
  )
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
            <FolderGit2Icon className="size-3.5" />
            <span className="hidden sm:inline">Worktree</span>
          </>
        ) : (
          <>
            <FolderIcon className="size-3.5" />
            <span className="hidden sm:inline">Local</span>
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
          <FolderGit2Icon className="size-3.5" />
        ) : (
          <FolderIcon className="size-3.5" />
        )}
        <span className="hidden sm:inline">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="local">
          <span className="inline-flex items-center gap-1.5">
            <FolderIcon className="size-3.5" />
            Local
          </span>
        </SelectItem>
        <SelectItem value="worktree">
          <span className="inline-flex items-center gap-1.5">
            <FolderGit2Icon className="size-3.5" />
            New worktree
          </span>
        </SelectItem>
      </SelectPopup>
    </Select>
  )
}

function useBranchToolbarSetBranch(input: {
  threadId: ThreadId
  activeThreadId: ThreadId | undefined
  serverThread: ReturnType<typeof useBranchToolbarState>['serverThread']
  activeWorktreePath: string | null
  hasServerThread: boolean
  effectiveEnvMode: EnvMode
}) {
  const setThreadBranchAction = useStore(store => store.setThreadBranch)
  const setDraftThreadContext = useComposerDraftStore(store => store.setDraftThreadContext)
  return useCallback(
    (branch: string | null, worktreePath: string | null) =>
      createSetThreadBranchAction({
        ...input,
        setThreadBranchAction,
        setDraftThreadContext,
      })(branch, worktreePath),
    [input, setThreadBranchAction, setDraftThreadContext]
  )
}

function BranchToolbarLeftGroup(props: {
  threadId: ThreadId
  state: ReturnType<typeof useBranchToolbarState>
  envLocked: boolean
  onEnvModeChange: (mode: EnvMode) => void
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void
  onCheckoutPullRequestRequest?: (reference: string) => void
  onComposerFocusRequest?: () => void
}) {
  const { state } = props
  if (!state.activeProject) return null
  return (
    <div className="flex min-w-0 items-center gap-1">
      <BranchToolbarEnvModeControl
        envLocked={props.envLocked}
        activeWorktreePath={state.activeWorktreePath}
        effectiveEnvMode={state.effectiveEnvMode}
        onEnvModeChange={props.onEnvModeChange}
      />
      <BranchToolbarRepoPicker
        threadId={props.threadId}
        activeProjectCwd={state.activeProject.cwd}
        activeGitRoot={state.serverThread?.gitRoot ?? null}
        hasServerThread={state.hasServerThread}
      />
      <BranchToolbarBranchSelector
        activeProjectCwd={state.activeProject.cwd}
        activeThreadBranch={state.activeThreadBranch}
        activeWorktreePath={state.activeWorktreePath}
        branchCwd={state.branchCwd}
        effectiveEnvMode={state.effectiveEnvMode}
        envLocked={props.envLocked}
        onSetThreadBranch={props.onSetThreadBranch}
        {...(props.onCheckoutPullRequestRequest
          ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
          : {})}
        {...(props.onComposerFocusRequest
          ? { onComposerFocusRequest: props.onComposerFocusRequest }
          : {})}
      />
    </div>
  )
}

function BranchToolbarRightGroup(props: {
  contextWindow: ContextWindowSnapshot | null | undefined
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  onToggleTerminal: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <BranchToolbarZenToggle />
      <BranchToolbarTerminalToggle
        terminalAvailable={props.terminalAvailable}
        terminalOpen={props.terminalOpen}
        terminalToggleLabel={props.terminalToggleLabel}
        onToggleTerminal={props.onToggleTerminal}
      />
      {props.contextWindow ? <ContextWindowMeter usage={props.contextWindow} /> : null}
    </div>
  )
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  envLocked,
  contextWindow,
  terminalAvailable,
  terminalOpen,
  terminalToggleLabel,
  onToggleTerminal,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const state = useBranchToolbarState(threadId)
  const setThreadBranch = useBranchToolbarSetBranch({
    threadId,
    activeThreadId: state.activeThreadId,
    serverThread: state.serverThread,
    activeWorktreePath: state.activeWorktreePath,
    hasServerThread: state.hasServerThread,
    effectiveEnvMode: state.effectiveEnvMode,
  })
  if (!state.activeThreadId || !state.activeProject) return null
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-5 pb-3 pt-1">
      <BranchToolbarLeftGroup
        threadId={threadId}
        state={state}
        envLocked={envLocked}
        onEnvModeChange={onEnvModeChange}
        onSetThreadBranch={setThreadBranch}
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
      <BranchToolbarRightGroup
        contextWindow={contextWindow}
        terminalAvailable={terminalAvailable}
        terminalOpen={terminalOpen}
        terminalToggleLabel={terminalToggleLabel}
        onToggleTerminal={onToggleTerminal}
      />
    </div>
  )
}
