import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { SessionMessageBundle, SessionRuntimeSnapshot } from '@shared/ipc'
import type { CodexMessageItem } from './codex-session-types'
import type { ClaudeChatMessageItem } from './useClaudeChatSession'
import { parseGitDiffOutput } from '../lib/git-diff'
import {
  buildClaudeCompactionState,
  buildClaudeRevertTargets,
  buildCodexCompactionState,
  buildCodexRevertTargets,
  buildOpencodeCompactionState,
  buildOpencodeRevertTargets,
  buildSessionGuardrailState,
  getOpencodeObservedTokenTotal,
  type SessionCompactionState,
  type SessionGuardrailPreferences,
  type SessionGuardrailPrompt,
  type SessionGuardrailState,
  type SessionRevertTarget,
  type TurnTokenSample,
} from '../lib/session-controls'

type SessionControlLocalState = {
  openedAt: number
  baselineTokenTotal: number
  softWarningDismissed: boolean
  continueOnceArmed: boolean
  disabledForSession: boolean
}

type SessionControlsResult = {
  compactionState: SessionCompactionState
  guardrailState: SessionGuardrailState
  guardrailPrompt: SessionGuardrailPrompt | null
  revertTargets: SessionRevertTarget[]
  dismissGuardrailWarning: () => void
  continueOnce: () => void
  disableGuardrailsForSession: () => void
  withGuardrails: <T>(send: () => Promise<T> | T) => Promise<T | undefined>
  revertTarget: (targetId: string) => Promise<boolean>
}

const localSessionControlState = new Map<string, SessionControlLocalState>()

function getOrCreateLocalState(sessionKey: string, baselineTokenTotal: number) {
  const existing = localSessionControlState.get(sessionKey)
  if (existing) {
    return existing
  }
  const created = {
    openedAt: Date.now(),
    baselineTokenTotal,
    softWarningDismissed: false,
    continueOnceArmed: false,
    disabledForSession: false,
  } satisfies SessionControlLocalState
  localSessionControlState.set(sessionKey, created)
  return created
}

function patchLocalState(
  sessionKey: string,
  updater: (current: SessionControlLocalState) => SessionControlLocalState
) {
  const current = localSessionControlState.get(sessionKey)
  if (!current) {
    return
  }
  localSessionControlState.set(sessionKey, updater(current))
}

function createGuardrailPrompt(
  state: SessionGuardrailState,
  warningDismissed: boolean
): SessionGuardrailPrompt | null {
  if (state.status === 'hard-stop') {
    return {
      level: 'hard-stop',
      title: 'Session limits reached',
      detail: `${state.detail}. The next send is blocked until you continue once or disable limits for this session.`,
    }
  }
  if (state.status === 'warning' && !warningDismissed) {
    return {
      level: 'warning',
      title: 'Session limits approaching',
      detail: `${state.detail}. You are close to the configured session limits.`,
    }
  }
  return null
}

function useSessionControlClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function useGitDiffFiles(directory: string, signature: string) {
  const [gitDiffFiles, setGitDiffFiles] = useState<ReturnType<typeof parseGitDiffOutput>['files']>([])

  useEffect(() => {
    let cancelled = false
    if (!directory || !window.orxa?.opencode?.gitDiff) {
      setGitDiffFiles([])
      return
    }
    void window.orxa.opencode
      .gitDiff(directory)
      .then(output => {
        if (!cancelled) {
          setGitDiffFiles(parseGitDiffOutput(output).files)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitDiffFiles([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [directory, signature])

  return gitDiffFiles
}

function useBaseSessionControls(args: {
  sessionKey: string
  directory: string
  preferences: SessionGuardrailPreferences
  rawObservedTokenTotal: number
  compactionState: SessionCompactionState
  buildRevertTargets: (gitDiffFiles: ReturnType<typeof parseGitDiffOutput>['files']) => SessionRevertTarget[]
}): SessionControlsResult {
  const now = useSessionControlClock()
  const [revision, setRevision] = useState(0)
  const baselineState = getOrCreateLocalState(args.sessionKey, args.rawObservedTokenTotal)
  const localState = localSessionControlState.get(args.sessionKey) ?? baselineState
  const observedTokenTotal = Math.max(0, args.rawObservedTokenTotal - localState.baselineTokenTotal)
  const runtimeMinutes = Math.max(0, (now - localState.openedAt) / 60_000)
  const guardrailState = useMemo(
    () =>
      buildSessionGuardrailState({
        preferences: args.preferences,
        observedTokenTotal,
        runtimeMinutes,
        disabledForSession: localState.disabledForSession,
        continueOnceArmed: localState.continueOnceArmed,
      }),
    [args.preferences, localState.continueOnceArmed, localState.disabledForSession, observedTokenTotal, runtimeMinutes]
  )

  const guardrailPrompt = createGuardrailPrompt(guardrailState, localState.softWarningDismissed)
  const gitDiffFiles = useGitDiffFiles(
    args.directory,
    `${args.sessionKey}:${revision}:${Math.round(observedTokenTotal)}:${Math.round(runtimeMinutes)}`
  )
  const revertTargets = useMemo(
    () => args.buildRevertTargets(gitDiffFiles),
    [args, gitDiffFiles]
  )
  const {
    continueOnce,
    disableGuardrailsForSession,
    dismissGuardrailWarning,
    revertTarget,
    withGuardrails,
  } = useSessionControlActions({
    sessionKey: args.sessionKey,
    directory: args.directory,
    preferences: args.preferences,
    baselineState,
    observedTokenTotal,
    runtimeMinutes,
    revertTargets,
    setRevision,
  })

  return {
    compactionState: args.compactionState,
    guardrailState,
    guardrailPrompt,
    revertTargets,
    dismissGuardrailWarning,
    continueOnce,
    disableGuardrailsForSession,
    withGuardrails,
    revertTarget,
  }
}

function useSessionControlActions(args: {
  sessionKey: string
  directory: string
  preferences: SessionGuardrailPreferences
  baselineState: SessionControlLocalState
  observedTokenTotal: number
  runtimeMinutes: number
  revertTargets: SessionRevertTarget[]
  setRevision: Dispatch<SetStateAction<number>>
}) {
  const updateAndRefresh = useCallback(
    (updater: (current: SessionControlLocalState) => SessionControlLocalState) => {
      patchLocalState(args.sessionKey, updater)
      args.setRevision(value => value + 1)
    },
    [args]
  )

  const dismissGuardrailWarning = useCallback(() => {
    updateAndRefresh(current => ({ ...current, softWarningDismissed: true }))
  }, [updateAndRefresh])

  const continueOnce = useCallback(() => {
    updateAndRefresh(current => ({
      ...current,
      continueOnceArmed: true,
      softWarningDismissed: true,
    }))
  }, [updateAndRefresh])

  const disableGuardrailsForSession = useCallback(() => {
    updateAndRefresh(current => ({
      ...current,
      disabledForSession: true,
      softWarningDismissed: true,
      continueOnceArmed: false,
    }))
  }, [updateAndRefresh])

  const withGuardrails = useCallback(
    async <T,>(send: () => Promise<T> | T) => {
      const current = localSessionControlState.get(args.sessionKey) ?? args.baselineState
      const state = buildSessionGuardrailState({
        preferences: args.preferences,
        observedTokenTotal: args.observedTokenTotal,
        runtimeMinutes: args.runtimeMinutes,
        disabledForSession: current.disabledForSession,
        continueOnceArmed: current.continueOnceArmed,
      })
      if (state.status === 'hard-stop' && !current.disabledForSession && !current.continueOnceArmed) {
        args.setRevision(value => value + 1)
        return undefined
      }
      if (current.continueOnceArmed) {
        patchLocalState(args.sessionKey, previous => ({
          ...previous,
          continueOnceArmed: false,
        }))
      }
      return await send()
    },
    [args]
  )

  const revertTarget = useCallback(
    async (targetId: string) => {
      const target = args.revertTargets.find(candidate => candidate.id === targetId)
      if (!target?.canRevert || !window.orxa?.opencode?.gitRestorePath) {
        return false
      }
      for (const file of target.files) {
        await window.orxa.opencode.gitRestorePath(args.directory, file.path)
      }
      args.setRevision(value => value + 1)
      return true
    },
    [args]
  )

  return {
    dismissGuardrailWarning,
    continueOnce,
    disableGuardrailsForSession,
    withGuardrails,
    revertTarget,
  }
}

export function useOpencodeSessionControls(args: {
  sessionKey: string
  directory: string
  preferences: SessionGuardrailPreferences
  messages: SessionMessageBundle[]
  runtimeSnapshot: SessionRuntimeSnapshot | null | undefined
}) {
  const rawObservedTokenTotal = getOpencodeObservedTokenTotal(args.messages)
  return useBaseSessionControls({
    sessionKey: args.sessionKey,
    directory: args.directory,
    preferences: args.preferences,
    rawObservedTokenTotal,
    compactionState: buildOpencodeCompactionState(args.messages),
    buildRevertTargets: gitDiffFiles =>
      buildOpencodeRevertTargets(args.messages, args.runtimeSnapshot, gitDiffFiles),
  })
}

export function useCodexSessionControls(args: {
  sessionKey: string
  directory: string
  preferences: SessionGuardrailPreferences
  messages: CodexMessageItem[]
  observedTokenTotal: number
  turnTokenTotals: TurnTokenSample[]
}) {
  return useBaseSessionControls({
    sessionKey: args.sessionKey,
    directory: args.directory,
    preferences: args.preferences,
    rawObservedTokenTotal: args.observedTokenTotal,
    compactionState: buildCodexCompactionState(args.messages, args.turnTokenTotals),
    buildRevertTargets: gitDiffFiles => buildCodexRevertTargets(args.messages, gitDiffFiles),
  })
}

export function useClaudeSessionControls(args: {
  sessionKey: string
  directory: string
  preferences: SessionGuardrailPreferences
  messages: ClaudeChatMessageItem[]
  observedTokenTotal: number
  turnTokenTotals: TurnTokenSample[]
}) {
  return useBaseSessionControls({
    sessionKey: args.sessionKey,
    directory: args.directory,
    preferences: args.preferences,
    rawObservedTokenTotal: args.observedTokenTotal,
    compactionState: buildClaudeCompactionState(args.turnTokenTotals),
    buildRevertTargets: gitDiffFiles => buildClaudeRevertTargets(args.messages, gitDiffFiles),
  })
}
