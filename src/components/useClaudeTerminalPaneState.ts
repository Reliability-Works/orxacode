import { useCallback, useEffect, useRef, useState } from 'react'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  getSessionPermissionMode,
  getStoredPermissionMode,
  setSessionPermissionMode,
  storePermissionMode,
  type PermissionMode,
} from './claude-terminal-session-store'

type SplitMode = 'none' | 'horizontal' | 'vertical'

function useClaudeTerminalSplitState() {
  const [splitMode, setSplitMode] = useState<SplitMode>('none')
  const [showSplitMenu, setShowSplitMenu] = useState(false)
  const [splitPanelKey, setSplitPanelKey] = useState(0)

  const handleSplit = useCallback((mode: 'horizontal' | 'vertical') => {
    if (splitMode === 'none') {
      setSplitPanelKey(key => key + 1)
    }
    setSplitMode(mode)
    setShowSplitMenu(false)
  }, [splitMode])

  const handleUnsplit = useCallback(() => {
    setSplitMode('none')
    setShowSplitMenu(false)
  }, [])

  return {
    splitMode,
    showSplitMenu,
    setShowSplitMenu,
    splitPanelKey,
    handleSplit,
    handleUnsplit,
  }
}

export function useClaudeTerminalPaneState({
  directory,
  sessionStorageKey,
  onFirstInteraction,
}: {
  directory: string
  sessionStorageKey: string
  onFirstInteraction?: () => void
}) {
  const [unavailable, setUnavailable] = useState(false)
  const [rememberChoice, setRememberChoice] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    getStoredPermissionMode(directory) ?? 'pending'
  )
  const {
    splitMode,
    showSplitMenu,
    setShowSplitMenu,
    splitPanelKey,
    handleSplit,
    handleUnsplit,
  } = useClaudeTerminalSplitState()
  const busyResetTimerRef = useRef<number | null>(null)
  const initClaudeSession = useUnifiedRuntimeStore(state => state.initClaudeSession)
  const setClaudeBusy = useUnifiedRuntimeStore(state => state.setClaudeBusy)
  const setClaudeAwaiting = useUnifiedRuntimeStore(state => state.setClaudeAwaiting)
  const setClaudeActivityAt = useUnifiedRuntimeStore(state => state.setClaudeActivityAt)

  const clearBusyResetTimer = useCallback(() => {
    if (busyResetTimerRef.current !== null) {
      window.clearTimeout(busyResetTimerRef.current)
      busyResetTimerRef.current = null
    }
  }, [])

  const handleTerminalOutput = useCallback(() => {
    if (permissionMode === 'pending') return
    setClaudeActivityAt(sessionStorageKey, Date.now())
    setClaudeBusy(sessionStorageKey, true)
    clearBusyResetTimer()
    busyResetTimerRef.current = window.setTimeout(() => {
      busyResetTimerRef.current = null
      setClaudeBusy(sessionStorageKey, false)
    }, 2200)
  }, [clearBusyResetTimer, permissionMode, sessionStorageKey, setClaudeActivityAt, setClaudeBusy])

  useEffect(() => {
    const storedSessionMode = getSessionPermissionMode(sessionStorageKey)
    if (storedSessionMode === 'standard' || storedSessionMode === 'full') {
      setPermissionMode(storedSessionMode)
      return
    }
    const storedWorkspaceMode = getStoredPermissionMode(directory)
    setPermissionMode(storedWorkspaceMode === 'standard' || storedWorkspaceMode === 'full' ? storedWorkspaceMode : 'pending')
  }, [directory, sessionStorageKey])

  useEffect(() => {
    initClaudeSession(sessionStorageKey, directory)
  }, [directory, initClaudeSession, sessionStorageKey])

  useEffect(() => {
    setUnavailable(permissionMode !== 'pending' && !window.orxa?.claudeTerminal)
    if (permissionMode !== 'pending') {
      onFirstInteraction?.()
    }
  }, [onFirstInteraction, permissionMode])

  useEffect(() => {
    const awaiting = permissionMode === 'pending'
    setClaudeAwaiting(sessionStorageKey, awaiting)
    if (awaiting) {
      clearBusyResetTimer()
      setClaudeBusy(sessionStorageKey, false)
    }
  }, [clearBusyResetTimer, permissionMode, sessionStorageKey, setClaudeAwaiting, setClaudeBusy])

  useEffect(
    () => () => {
      clearBusyResetTimer()
      setClaudeAwaiting(sessionStorageKey, false)
      setClaudeBusy(sessionStorageKey, false)
    },
    [clearBusyResetTimer, sessionStorageKey, setClaudeAwaiting, setClaudeBusy]
  )

  const handlePermissionChoice = useCallback((mode: 'standard' | 'full') => {
    setSessionPermissionMode(sessionStorageKey, mode)
    if (rememberChoice) {
      storePermissionMode(directory, mode)
    }
    setPermissionMode(mode)
    onFirstInteraction?.()
  }, [directory, onFirstInteraction, rememberChoice, sessionStorageKey])

  return {
    unavailable,
    rememberChoice,
    setRememberChoice,
    permissionMode,
    splitMode,
    showSplitMenu,
    setShowSplitMenu,
    splitPanelKey,
    handleTerminalOutput,
    handlePermissionChoice,
    handleSplit,
    handleUnsplit,
  }
}
