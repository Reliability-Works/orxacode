import { useCallback, useEffect, useRef } from 'react'
import type { ProjectScript, ThreadId } from '@orxa-code/contracts'
import type { TerminalOpenInput } from '@orxa-code/contracts'
import { randomUUID } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import { DEFAULT_THREAD_TERMINAL_ID } from '../../types'
import { projectScriptRuntimeEnv } from '../../projectScripts'
import type { TerminalContextSelection, TerminalContextDraft } from '../../lib/terminalContext'
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from '../../composer-logic'
import { insertInlineTerminalContextPlaceholder } from '../../lib/terminalContext'
import type { ComposerPromptEditorHandle } from '../ComposerPromptEditor'

export type RunScriptOptions = {
  cwd?: string
  env?: Record<string, string>
  worktreePath?: string | null
  preferNewTerminal?: boolean
  rememberAsLastInvoked?: boolean
}

const SCRIPT_TERMINAL_COLS = 120
const SCRIPT_TERMINAL_ROWS = 30
const MAX_TERMINALS_PER_GROUP = 4

// ---------------------------------------------------------------------------
// Terminal visibility + height controls
// ---------------------------------------------------------------------------

export function useChatTerminalOpenControls(
  activeThreadId: ThreadId | null,
  terminalOpen: boolean,
  storeSetTerminalOpen: (id: ThreadId, open: boolean) => void,
  storeSetTerminalHeight: (id: ThreadId, height: number) => void
) {
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadId) return
      storeSetTerminalOpen(activeThreadId, open)
    },
    [activeThreadId, storeSetTerminalOpen]
  )

  const setTerminalHeight = useCallback(
    (height: number) => {
      if (!activeThreadId) return
      storeSetTerminalHeight(activeThreadId, height)
    },
    [activeThreadId, storeSetTerminalHeight]
  )

  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadId) return
    setTerminalOpen(!terminalOpen)
  }, [activeThreadId, setTerminalOpen, terminalOpen])

  return { setTerminalOpen, setTerminalHeight, toggleTerminalVisibility }
}

// ---------------------------------------------------------------------------
// Terminal create / split / activate / close
// ---------------------------------------------------------------------------

export function useChatTerminalManagement(
  activeThreadId: ThreadId | null,
  terminalState: {
    terminalIds: string[]
    activeTerminalId: string
    runningTerminalIds: string[]
    terminalGroups: Array<{ id: string; terminalIds: string[] }>
  },
  storeSplitTerminal: (id: ThreadId, terminalId: string) => void,
  storeNewTerminal: (id: ThreadId, terminalId: string) => void,
  storeSetActiveTerminal: (id: ThreadId, terminalId: string) => void,
  storeCloseTerminal: (id: ThreadId, terminalId: string) => void,
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>
) {
  const splitTerminal = useCallback(() => {
    if (!activeThreadId) return
    const activeGroup = terminalState.terminalGroups.find(g =>
      g.terminalIds.includes(terminalState.activeTerminalId)
    )
    if ((activeGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP) return
    storeSplitTerminal(activeThreadId, `terminal-${randomUUID()}`)
    setTerminalFocusRequestId(v => v + 1)
  }, [activeThreadId, terminalState, storeSplitTerminal, setTerminalFocusRequestId])

  const createNewTerminal = useCallback(() => {
    if (!activeThreadId) return
    storeNewTerminal(activeThreadId, `terminal-${randomUUID()}`)
    setTerminalFocusRequestId(v => v + 1)
  }, [activeThreadId, storeNewTerminal, setTerminalFocusRequestId])

  const activateTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) return
      storeSetActiveTerminal(activeThreadId, terminalId)
      setTerminalFocusRequestId(v => v + 1)
    },
    [activeThreadId, storeSetActiveTerminal, setTerminalFocusRequestId]
  )

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readNativeApi()
      if (!activeThreadId || !api) return
      const isFinal = terminalState.terminalIds.length <= 1
      const fallback = () =>
        api.terminal
          .write({ threadId: activeThreadId, terminalId, data: 'exit\n' })
          .catch(() => undefined)
      if ('close' in api.terminal && typeof api.terminal.close === 'function') {
        void (async () => {
          if (isFinal)
            await api.terminal
              .clear({ threadId: activeThreadId, terminalId })
              .catch(() => undefined)
          await api.terminal.close({ threadId: activeThreadId, terminalId, deleteHistory: true })
        })().catch(() => fallback())
      } else {
        void fallback()
      }
      storeCloseTerminal(activeThreadId, terminalId)
      setTerminalFocusRequestId(v => v + 1)
    },
    [
      activeThreadId,
      terminalState.terminalIds.length,
      storeCloseTerminal,
      setTerminalFocusRequestId,
    ]
  )

  return { splitTerminal, createNewTerminal, activateTerminal, closeTerminal }
}

// ---------------------------------------------------------------------------
// Terminal focus effect (open/close side-effects on focusComposer)
// ---------------------------------------------------------------------------

export function useChatTerminalFocusEffect(
  activeThreadId: ThreadId | null,
  terminalOpen: boolean,
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>,
  focusComposer: () => void
) {
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    if (!activeThreadId) return
    const previous = terminalOpenByThreadRef.current[activeThreadId] ?? false
    const current = Boolean(terminalOpen)
    terminalOpenByThreadRef.current[activeThreadId] = current
    if (!previous && current) {
      setTerminalFocusRequestId(v => v + 1)
      return
    }
    if (previous && !current) {
      const frame = window.requestAnimationFrame(() => {
        focusComposer()
      })
      return () => {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [activeThreadId, terminalOpen, focusComposer, setTerminalFocusRequestId])

  return terminalOpenByThreadRef
}

// ---------------------------------------------------------------------------
// Run project script
// ---------------------------------------------------------------------------

interface RunScriptParams {
  activeThreadId: ThreadId
  activeProjectCwd: string
  activeWorktreePath: string | null
  gitCwd: string | null
  terminalIds: string[]
  activeTerminalId: string
  runningTerminalIds: string[]
  storeNewTerminal: (id: ThreadId, terminalId: string) => void
  storeSetActiveTerminal: (id: ThreadId, terminalId: string) => void
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>
  setLastInvokedScriptByProjectId: (
    updater: (current: Record<string, string>) => Record<string, string>
  ) => void
  setTerminalOpen: (open: boolean) => void
  setThreadError: (id: ThreadId | null, error: string | null) => void
  projectId: string
}

async function executeRunScript(
  script: ProjectScript,
  options: RunScriptOptions | undefined,
  params: RunScriptParams
): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  if (options?.rememberAsLastInvoked !== false) {
    params.setLastInvokedScriptByProjectId(cur => {
      if (cur[params.projectId] === script.id) return cur
      return { ...cur, [params.projectId]: script.id }
    })
  }
  const targetCwd = options?.cwd ?? params.gitCwd ?? params.activeProjectCwd
  const baseId = params.activeTerminalId || params.terminalIds[0] || DEFAULT_THREAD_TERMINAL_ID
  const shouldNew =
    Boolean(options?.preferNewTerminal) || params.runningTerminalIds.includes(baseId)
  const targetId = shouldNew ? `terminal-${randomUUID()}` : baseId
  params.setTerminalOpen(true)
  if (shouldNew) {
    params.storeNewTerminal(params.activeThreadId, targetId)
  } else {
    params.storeSetActiveTerminal(params.activeThreadId, targetId)
  }
  params.setTerminalFocusRequestId(v => v + 1)
  const runtimeEnv = projectScriptRuntimeEnv({
    project: { cwd: params.activeProjectCwd },
    worktreePath: options?.worktreePath ?? params.activeWorktreePath,
    ...(options?.env ? { extraEnv: options.env } : {}),
  })
  const openInput: TerminalOpenInput = shouldNew
    ? {
        threadId: params.activeThreadId,
        terminalId: targetId,
        cwd: targetCwd,
        env: runtimeEnv,
        cols: SCRIPT_TERMINAL_COLS,
        rows: SCRIPT_TERMINAL_ROWS,
      }
    : { threadId: params.activeThreadId, terminalId: targetId, cwd: targetCwd, env: runtimeEnv }
  try {
    await api.terminal.open(openInput)
    await api.terminal.write({
      threadId: params.activeThreadId,
      terminalId: targetId,
      data: `${script.command}\r`,
    })
  } catch (error) {
    params.setThreadError(
      params.activeThreadId,
      error instanceof Error ? error.message : `Failed to run script "${script.name}".`
    )
  }
}

export function useChatRunProjectScript(
  activeThreadId: ThreadId | null,
  activeProjectCwd: string | null,
  activeWorktreePath: string | null,
  gitCwd: string | null,
  projectId: string | null,
  terminalState: { terminalIds: string[]; activeTerminalId: string; runningTerminalIds: string[] },
  storeNewTerminal: (id: ThreadId, terminalId: string) => void,
  storeSetActiveTerminal: (id: ThreadId, terminalId: string) => void,
  setTerminalFocusRequestId: React.Dispatch<React.SetStateAction<number>>,
  setLastInvokedScriptByProjectId: (
    updater: (cur: Record<string, string>) => Record<string, string>
  ) => void,
  setTerminalOpen: (open: boolean) => void,
  setThreadError: (id: ThreadId | null, error: string | null) => void
) {
  return useCallback(
    async (script: ProjectScript, options?: RunScriptOptions) => {
      if (!activeThreadId || !activeProjectCwd || !projectId) return
      await executeRunScript(script, options, {
        activeThreadId,
        activeProjectCwd,
        activeWorktreePath,
        gitCwd,
        terminalIds: terminalState.terminalIds,
        activeTerminalId: terminalState.activeTerminalId,
        runningTerminalIds: terminalState.runningTerminalIds,
        storeNewTerminal,
        storeSetActiveTerminal,
        setTerminalFocusRequestId,
        setLastInvokedScriptByProjectId,
        setTerminalOpen,
        setThreadError,
        projectId,
      })
    },
    [
      activeThreadId,
      activeProjectCwd,
      activeWorktreePath,
      gitCwd,
      projectId,
      terminalState,
      storeNewTerminal,
      storeSetActiveTerminal,
      setTerminalFocusRequestId,
      setLastInvokedScriptByProjectId,
      setTerminalOpen,
      setThreadError,
    ]
  )
}

// ---------------------------------------------------------------------------
// Add terminal context to composer draft
// ---------------------------------------------------------------------------

export function useChatAddTerminalContext(
  activeThread: { id: string } | null,
  composerCursor: number,
  composerTerminalContexts: TerminalContextDraft[],
  promptRef: React.MutableRefObject<string>,
  composerEditorRef: React.RefObject<ComposerPromptEditorHandle | null>,
  insertComposerDraftTerminalContext: (
    threadId: ThreadId,
    prompt: string,
    context: TerminalContextDraft,
    contextIndex: number
  ) => boolean,
  setComposerCursor: (cursor: number) => void,
  setComposerTrigger: (trigger: ComposerTrigger | null) => void
) {
  return useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThread) return
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map(c => c.id),
      }
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor
      )
      const nextCursor = collapseExpandedComposerCursor(insertion.prompt, insertion.cursor)
      const inserted = insertComposerDraftTerminalContext(
        activeThread.id as ThreadId,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id as ThreadId,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex
      )
      if (!inserted) return
      promptRef.current = insertion.prompt
      setComposerCursor(nextCursor)
      setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor))
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor)
      })
    },
    [
      activeThread,
      composerCursor,
      composerTerminalContexts,
      promptRef,
      composerEditorRef,
      insertComposerDraftTerminalContext,
      setComposerCursor,
      setComposerTrigger,
    ]
  )
}
