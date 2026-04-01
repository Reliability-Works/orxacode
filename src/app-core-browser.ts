import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { BrowserHistoryItem, BrowserState, McpDevToolsServerState, SessionMessageBundle } from '@shared/ipc'
import type { BrowserControlOwner } from './lib/app-session-utils'
import { DEFAULT_BROWSER_LANDING_URL, EMPTY_BROWSER_RUNTIME_STATE } from './lib/app-session-utils'
import { mergeModeToolPolicies } from './lib/browser-tool-guardrails'
import { useBrowserAgentBridge } from './hooks/useBrowserAgentBridge'
import { useBrowserPromptMetadata } from './app-core-browser-prompt'

type BrowserContext = {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  activeSessionKey: string | null
  composer: string
  messages: SessionMessageBundle[]
  browserPaneVisible: boolean
  setBrowserModeBySession: Dispatch<SetStateAction<Record<string, boolean>>>
  setBrowserAutomationHaltedBySession: Dispatch<SetStateAction<Record<string, number>>>
  setBrowserSidebarOpen: Dispatch<SetStateAction<boolean>>
  setStatusLine: Dispatch<SetStateAction<string>>
  browserModeBySession: Record<string, boolean>
  browserAutomationHaltedBySession: Record<string, number>
  browserSidebarOpen: boolean
  abortSession: () => Promise<void>
}

type BrowserStateApi = {
  activePromptToolsPolicy: ReturnType<typeof mergeModeToolPolicies>
  browserActionRunning: boolean
  browserAutomationHalted: boolean
  browserAutopilotHint: string | undefined
  browserCloseTab: (tabID: string) => Promise<void>
  browserControlOwner: BrowserControlOwner
  browserGoBack: () => Promise<void>
  browserGoForward: () => Promise<void>
  browserHandBack: () => void
  browserHistoryItems: BrowserHistoryItem[]
  browserModeEnabled: boolean
  browserNavigate: (url: string) => Promise<void>
  browserOpenTab: () => Promise<void>
  browserReload: () => Promise<void>
  browserReportViewportBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  browserRuntimeState: BrowserState
  browserSelectHistory: (url: string) => Promise<void>
  browserSelectTab: (tabID: string) => Promise<void>
  browserSidebarOpen: boolean
  browserStop: () => Promise<void>
  browserTakeControl: () => Promise<void>
  clearBrowserAutomationHalt: (directory: string, sessionID: string) => void
  effectiveSystemAddendum: string | undefined
  ensureBrowserTab: () => Promise<BrowserState>
  mcpDevToolsState: McpDevToolsServerState
  setBrowserMode: (enabled: boolean) => Promise<void>
  setBrowserActionRunning: Dispatch<SetStateAction<boolean>>
  setBrowserHistoryItems: Dispatch<SetStateAction<BrowserHistoryItem[]>>
  setBrowserRuntimeState: Dispatch<SetStateAction<BrowserState>>
  setMcpDevToolsState: Dispatch<SetStateAction<McpDevToolsServerState>>
  syncBrowserSnapshot: () => Promise<void>
}

type BrowserRuntime = {
  browserControlOwner: BrowserControlOwner
  browserRuntimeState: BrowserState
  browserHistoryItems: BrowserHistoryItem[]
  browserActionRunning: boolean
  mcpDevToolsState: McpDevToolsServerState
  setBrowserControlOwnerState: Dispatch<SetStateAction<BrowserControlOwner>>
  setBrowserRuntimeStateState: Dispatch<SetStateAction<BrowserState>>
  setBrowserHistoryItemsState: Dispatch<SetStateAction<BrowserHistoryItem[]>>
  setBrowserActionRunningState: Dispatch<SetStateAction<boolean>>
  setMcpDevToolsStateState: Dispatch<SetStateAction<McpDevToolsServerState>>
  syncBrowserSnapshot: () => Promise<void>
  ensureBrowserTab: () => Promise<BrowserState>
  runBrowserStateCommand: (command: () => Promise<BrowserState>) => Promise<void>
  browserReportViewportBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
}

function useBrowserSessionFlags(context: BrowserContext) {
  const { activeSessionKey, browserModeBySession, browserAutomationHaltedBySession } = context
  const browserModeEnabled = activeSessionKey
    ? browserModeBySession[activeSessionKey] === true
    : false
  const browserAutomationHalted = useMemo(
    () =>
      activeSessionKey ? typeof browserAutomationHaltedBySession[activeSessionKey] === 'number' : false,
    [activeSessionKey, browserAutomationHaltedBySession]
  )
  return { browserModeEnabled, browserAutomationHalted }
}

function useBrowserRuntime(setStatusLine: Dispatch<SetStateAction<string>>): BrowserRuntime {
  const [browserControlOwner, setBrowserControlOwnerState] = useState<BrowserControlOwner>('agent')
  const [browserRuntimeState, setBrowserRuntimeStateState] = useState<BrowserState>(
    EMPTY_BROWSER_RUNTIME_STATE
  )
  const [browserHistoryItems, setBrowserHistoryItemsState] = useState<BrowserHistoryItem[]>([])
  const [browserActionRunning, setBrowserActionRunningState] = useState(false)
  const [mcpDevToolsState, setMcpDevToolsStateState] = useState<McpDevToolsServerState>('stopped')
  const lastBrowserBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null
  )

  const syncBrowserSnapshot = useCallback(async () => {
    const [nextState, nextHistory] = await Promise.all([
      window.orxa.browser.getState(),
      window.orxa.browser.listHistory(200),
    ])
    setBrowserRuntimeStateState(nextState)
    setBrowserHistoryItemsState(nextHistory)
  }, [])

  const ensureBrowserTab = useCallback(async () => {
    const current = await window.orxa.browser.getState()
    if (current.tabs.length > 0) {
      setBrowserRuntimeStateState(current)
      return current
    }
    const nextState = await window.orxa.browser.openTab(DEFAULT_BROWSER_LANDING_URL, true)
    setBrowserRuntimeStateState(nextState)
    return nextState
  }, [])

  const runBrowserStateCommand = useCallback(
    async (command: () => Promise<BrowserState>) => {
      try {
        const nextState = await command()
        setBrowserRuntimeStateState(nextState)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [setStatusLine]
  )

  const browserReportViewportBounds = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      const previous = lastBrowserBoundsRef.current
      if (
        previous &&
        previous.x === bounds.x &&
        previous.y === bounds.y &&
        previous.width === bounds.width &&
        previous.height === bounds.height
      ) {
        return
      }
      lastBrowserBoundsRef.current = bounds
      void window.orxa.browser
        .setBounds(bounds)
        .then(nextState => {
          setBrowserRuntimeStateState(nextState)
        })
        .catch(error => {
          setStatusLine(error instanceof Error ? error.message : String(error))
        })
    },
    [setStatusLine]
  )

  return {
    browserControlOwner,
    browserRuntimeState,
    browserHistoryItems,
    browserActionRunning,
    mcpDevToolsState,
    setBrowserControlOwnerState,
    setBrowserRuntimeStateState,
    setBrowserHistoryItemsState,
    setBrowserActionRunningState,
    setMcpDevToolsStateState,
    syncBrowserSnapshot,
    ensureBrowserTab,
    runBrowserStateCommand,
    browserReportViewportBounds,
  }
}

function useBrowserNavigationCommands(runBrowserStateCommand: BrowserRuntime['runBrowserStateCommand']) {
  const browserNavigate = useCallback(
    async (url: string) => {
      await runBrowserStateCommand(() => window.orxa.browser.navigate(url))
    },
    [runBrowserStateCommand]
  )

  const browserOpenTab = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.openTab(DEFAULT_BROWSER_LANDING_URL, true))
  }, [runBrowserStateCommand])

  const browserCloseTab = useCallback(
    async (tabID: string) => {
      await runBrowserStateCommand(() => window.orxa.browser.closeTab(tabID))
    },
    [runBrowserStateCommand]
  )

  const browserGoBack = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.back())
  }, [runBrowserStateCommand])

  const browserGoForward = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.forward())
  }, [runBrowserStateCommand])

  const browserReload = useCallback(async () => {
    await runBrowserStateCommand(() => window.orxa.browser.reload())
  }, [runBrowserStateCommand])

  const browserSelectTab = useCallback(
    async (tabID: string) => {
      await runBrowserStateCommand(() => window.orxa.browser.switchTab(tabID))
    },
    [runBrowserStateCommand]
  )

  const browserSelectHistory = useCallback(
    async (url: string) => {
      await runBrowserStateCommand(() => window.orxa.browser.navigate(url))
    },
    [runBrowserStateCommand]
  )

  return {
    browserNavigate,
    browserOpenTab,
    browserCloseTab,
    browserGoBack,
    browserGoForward,
    browserReload,
    browserSelectTab,
    browserSelectHistory,
  }
}

type BrowserModeControlsArgs = { context: BrowserContext; runtime: BrowserRuntime; browserModeEnabled: boolean }

function useSetBrowserMode({
  activeProjectDir,
  activeSessionKey,
  setBrowserModeBySession,
  setStatusLine,
  setMcpDevToolsStateState,
  setBrowserActionRunningState,
  ensureBrowserTab,
  syncBrowserSnapshot,
}: {
  activeProjectDir: string | undefined
  activeSessionKey: string | null
  setBrowserModeBySession: BrowserContext['setBrowserModeBySession']
  setStatusLine: BrowserContext['setStatusLine']
  setMcpDevToolsStateState: BrowserRuntime['setMcpDevToolsStateState']
  setBrowserActionRunningState: BrowserRuntime['setBrowserActionRunningState']
  ensureBrowserTab: BrowserRuntime['ensureBrowserTab']
  syncBrowserSnapshot: BrowserRuntime['syncBrowserSnapshot']
}) {
  return useCallback(
    async (enabled: boolean) => {
      if (!activeSessionKey || !activeProjectDir) {
        return
      }
      setBrowserModeBySession(current => ({
        ...current,
        [activeSessionKey]: enabled,
      }))
      if (!enabled) {
        setBrowserActionRunningState(false)
        window.orxa.mcpDevTools.stop(activeProjectDir).then(
          status => setMcpDevToolsStateState(status.state),
          () => setMcpDevToolsStateState('stopped')
        )
        return
      }
      try {
        await ensureBrowserTab()
        await syncBrowserSnapshot()
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
      window.orxa.mcpDevTools.start(activeProjectDir).then(
        status => {
          if (status.state === 'error') {
            setStatusLine(`MCP DevTools error: ${status.error ?? 'unknown'}`)
          }
          setMcpDevToolsStateState(status.state)
        },
        err => {
          const message = err instanceof Error ? err.message : String(err)
          setStatusLine(`MCP DevTools failed: ${message}`)
          setMcpDevToolsStateState('error')
        }
      )
    },
    [
      activeProjectDir,
      activeSessionKey,
      ensureBrowserTab,
      setBrowserModeBySession,
      setStatusLine,
      syncBrowserSnapshot,
      setMcpDevToolsStateState,
      setBrowserActionRunningState,
    ]
  )
}

function useBrowserModeControls({ context, runtime, browserModeEnabled }: BrowserModeControlsArgs) {
  const {
    activeProjectDir,
    activeSessionKey,
    setBrowserModeBySession,
    setBrowserAutomationHaltedBySession,
    setStatusLine,
    abortSession,
  } = context
  const {
    setBrowserControlOwnerState,
    setBrowserActionRunningState,
    setMcpDevToolsStateState,
    ensureBrowserTab,
    syncBrowserSnapshot,
  } = runtime

  const setBrowserMode = useSetBrowserMode({
    activeProjectDir,
    activeSessionKey,
    setBrowserModeBySession,
    setStatusLine,
    setMcpDevToolsStateState,
    setBrowserActionRunningState,
    ensureBrowserTab,
    syncBrowserSnapshot,
  })

  const browserTakeControl = useCallback(async () => {
    setBrowserControlOwnerState('human')
    setBrowserActionRunningState(false)
    try {
      await abortSession()
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [abortSession, setBrowserActionRunningState, setBrowserControlOwnerState, setStatusLine])

  const browserHandBack = useCallback(() => {
    setBrowserControlOwnerState('agent')
  }, [setBrowserControlOwnerState])

  const browserStop = useCallback(async () => {
    setBrowserActionRunningState(false)
    try {
      await abortSession()
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [abortSession, setBrowserActionRunningState, setStatusLine])

  const clearBrowserAutomationHalt = useCallback(
    (directory: string, sessionID: string) => {
      const key = `${directory}::${sessionID}`
      setBrowserAutomationHaltedBySession(current => {
        if (!(key in current)) {
          return current
        }
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    [setBrowserAutomationHaltedBySession]
  )

  useEffect(() => {
    if (!browserModeEnabled) {
      setBrowserControlOwnerState('agent')
      setBrowserActionRunningState(false)
    }
  }, [browserModeEnabled, setBrowserActionRunningState, setBrowserControlOwnerState])

  return {
    setBrowserMode,
    browserTakeControl,
    browserHandBack,
    browserStop,
    clearBrowserAutomationHalt,
  }
}

type BrowserBridgeEffectsArgs = {
  context: BrowserContext; runtime: BrowserRuntime; browserModeEnabled: boolean; browserAutomationHalted: boolean
}

function useBrowserBridgeAndEffects({
  context,
  runtime,
  browserModeEnabled,
  browserAutomationHalted,
}: BrowserBridgeEffectsArgs) {
  const {
    activeProjectDir,
    activeSessionID,
    browserPaneVisible,
    browserSidebarOpen,
    messages,
    setBrowserSidebarOpen,
    setStatusLine,
    setBrowserAutomationHaltedBySession,
  } = context
  const {
    browserControlOwner,
    setBrowserActionRunningState,
    setBrowserRuntimeStateState,
    ensureBrowserTab,
  } = runtime

  const handleBrowserGuardrailViolation = useCallback(
    (message: string) => {
      const now = Date.now()
      const normalized = message.toLowerCase()
      const isForbiddenToolUsage = normalized.includes('blocked forbidden tool usage in browser mode')
      const shouldHaltAutomation = normalized.includes('automation was halted')
      setBrowserActionRunningState(false)
      if (!isForbiddenToolUsage) {
        setStatusLine(message)
      }
      if (shouldHaltAutomation && activeProjectDir && activeSessionID) {
        const key = `${activeProjectDir}::${activeSessionID}`
        setBrowserAutomationHaltedBySession(current => ({
          ...current,
          [key]: now,
        }))
      }
    },
    [activeProjectDir, activeSessionID, setBrowserActionRunningState, setBrowserAutomationHaltedBySession, setStatusLine]
  )

  useBrowserAgentBridge({
    activeProjectDir: activeProjectDir ?? null,
    activeSessionID: activeSessionID ?? null,
    messages,
    browserModeEnabled,
    controlOwner: browserControlOwner,
    automationHalted: browserAutomationHalted,
    onActionStart: () => {
      setBrowserSidebarOpen(true)
      setBrowserActionRunningState(true)
    },
    onStatus: setStatusLine,
    onGuardrailViolation: handleBrowserGuardrailViolation,
  })

  useEffect(() => {
    if (browserAutomationHalted) {
      setBrowserActionRunningState(false)
    }
  }, [browserAutomationHalted, setBrowserActionRunningState])

  useEffect(() => {
    if (!browserSidebarOpen || !browserModeEnabled) {
      return
    }
    void ensureBrowserTab().catch(error => {
      setStatusLine(error instanceof Error ? error.message : String(error))
    })
  }, [browserModeEnabled, browserSidebarOpen, ensureBrowserTab, setStatusLine])

  useEffect(() => {
    if (browserPaneVisible) {
      void window.orxa.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined)
    }
    void window.orxa.browser
      .setVisible(browserPaneVisible)
      .then(nextState => {
        setBrowserRuntimeStateState(nextState)
      })
      .catch(error => {
        setStatusLine(error instanceof Error ? error.message : String(error))
      })
  }, [browserPaneVisible, setBrowserRuntimeStateState, setStatusLine])
}

function useBrowserStateCommands(context: BrowserContext) {
  const { composer, browserSidebarOpen, setStatusLine } = context
  const { browserModeEnabled, browserAutomationHalted } = useBrowserSessionFlags(context)
  const runtime = useBrowserRuntime(setStatusLine)
  const navigation = useBrowserNavigationCommands(runtime.runBrowserStateCommand)
  const controls = useBrowserModeControls({ context, runtime, browserModeEnabled })

  useBrowserBridgeAndEffects({
    context,
    runtime,
    browserModeEnabled,
    browserAutomationHalted,
  })

  const promptMetadata = useBrowserPromptMetadata({
    composer,
    browserModeEnabled,
    browserControlOwner: runtime.browserControlOwner,
    mcpDevToolsState: runtime.mcpDevToolsState,
  })

  return {
    activePromptToolsPolicy: promptMetadata.activePromptToolsPolicy,
    browserActionRunning: runtime.browserActionRunning,
    browserAutomationHalted,
    browserAutopilotHint: promptMetadata.browserAutopilotHint,
    browserCloseTab: navigation.browserCloseTab,
    browserControlOwner: runtime.browserControlOwner,
    browserGoBack: navigation.browserGoBack,
    browserGoForward: navigation.browserGoForward,
    browserHandBack: controls.browserHandBack,
    browserHistoryItems: runtime.browserHistoryItems,
    browserModeEnabled,
    browserNavigate: navigation.browserNavigate,
    browserOpenTab: navigation.browserOpenTab,
    browserReload: navigation.browserReload,
    browserReportViewportBounds: runtime.browserReportViewportBounds,
    browserRuntimeState: runtime.browserRuntimeState,
    browserSelectHistory: navigation.browserSelectHistory,
    browserSelectTab: navigation.browserSelectTab,
    browserSidebarOpen,
    browserStop: controls.browserStop,
    browserTakeControl: controls.browserTakeControl,
    clearBrowserAutomationHalt: controls.clearBrowserAutomationHalt,
    effectiveSystemAddendum: promptMetadata.effectiveSystemAddendum,
    ensureBrowserTab: runtime.ensureBrowserTab,
    mcpDevToolsState: runtime.mcpDevToolsState,
    setBrowserMode: controls.setBrowserMode,
    setBrowserActionRunning: runtime.setBrowserActionRunningState,
    setBrowserHistoryItems: runtime.setBrowserHistoryItemsState,
    setBrowserRuntimeState: runtime.setBrowserRuntimeStateState,
    setMcpDevToolsState: runtime.setMcpDevToolsStateState,
    syncBrowserSnapshot: runtime.syncBrowserSnapshot,
  } satisfies BrowserStateApi
}

export function useAppCoreBrowser(context: BrowserContext) {
  const api = useBrowserStateCommands(context)
  return api
}
