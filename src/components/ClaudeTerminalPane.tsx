import { useEffect, useRef, useState, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import 'xterm/css/xterm.css'
import { createManagedTerminal, type ManagedTerminal } from '../lib/xterm-terminal'
import { ClaudeTerminalPaneView } from './ClaudeTerminalPane.view'
import {
  clearPendingClaudeSessionCreate,
  getOrCreateClaudeSession,
  persistedSessions,
  sessionKey,
  type PermissionMode,
  type PersistedSession,
} from './claude-terminal-session-store'
import { useClaudeTerminalPaneState } from './useClaudeTerminalPaneState'

const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#E5E5E5',
  cursor: '#525252',
  cursorAccent: '#000000',
  selectionBackground: '#22C55E33',
  black: '#000000',
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#F59E0B',
  blue: '#3B82F6',
  magenta: '#A78BFA',
  cyan: '#06B6D4',
  white: '#E5E5E5',
  brightBlack: '#525252',
  brightRed: '#F87171',
  brightGreen: '#4ADE80',
  brightYellow: '#FBBF24',
  brightBlue: '#60A5FA',
  brightMagenta: '#C4B5FD',
  brightCyan: '#22D3EE',
  brightWhite: '#FFFFFF',
}

const TERMINAL_OPTIONS = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 12,
  fontWeight: '300' as const,
  fontWeightBold: '500' as const,
  lineHeight: 1.4,
  cursorBlink: true,
  cursorStyle: 'bar' as const,
  theme: TERMINAL_THEME,
}

// ── Tab types ──

type ClaudeTab = {
  id: string
  label: string
}

let tabCounter = 0

function createTab(): ClaudeTab {
  tabCounter += 1
  return { id: `claude-tab-${tabCounter}`, label: `claude ${tabCounter}` }
}

interface Props {
  directory: string
  sessionStorageKey: string
  onExit: () => void
  onFirstInteraction?: () => void
}

// ── Panel instance ──
// A self-contained panel with its own mini tab bar and terminal.

interface ClaudePanelInstanceProps {
  directory: string
  sessionStorageKey: string
  mode: 'standard' | 'full'
  onClose?: () => void
  onAllTabsClosed?: () => void
  onTerminalOutput?: () => void
}

function ClaudePanelInstance({
  directory,
  sessionStorageKey,
  mode,
  onClose,
  onAllTabsClosed,
  onTerminalOutput,
}: ClaudePanelInstanceProps) {
  const [initialTab] = useState<ClaudeTab>(createTab)
  const [panelTabs, setPanelTabs] = useState<ClaudeTab[]>(() => [initialTab])
  const [panelActiveTabId, setPanelActiveTabId] = useState<string>(initialTab.id)

  function handleAddTab() {
    const tab = createTab()
    setPanelTabs(prev => [...prev, tab])
    setPanelActiveTabId(tab.id)
  }

  function handleCloseTab(tabId: string) {
    const key = sessionKey(sessionStorageKey, mode, tabId)
    const existing = persistedSessions.get(key)
    if (existing) {
      if (existing.backgroundUnsubscribe) existing.backgroundUnsubscribe()
      if (!existing.exited && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.close(existing.processId)
      }
      clearPendingClaudeSessionCreate(key)
      persistedSessions.delete(key)
    }

    setPanelTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      if (next.length === 0) {
        onAllTabsClosed?.()
        onClose?.()
        return prev
      }
      if (panelActiveTabId === tabId) {
        setPanelActiveTabId(next[0].id)
      }
      return next
    })
  }

  return (
    <div className="claude-split-panel">
      <div className="claude-panel-tab-bar">
        {panelTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`claude-tab ${panelActiveTabId === tab.id ? 'active' : ''}`}
            onClick={() => setPanelActiveTabId(tab.id)}
          >
            <span className="claude-tab-label">{tab.label}</span>
            <span
              className="claude-tab-close"
              role="button"
              tabIndex={-1}
              onClick={e => {
                e.stopPropagation()
                handleCloseTab(tab.id)
              }}
            >
              <X size={10} />
            </span>
          </button>
        ))}
        <button
          type="button"
          className="claude-tab claude-tab-add"
          onClick={handleAddTab}
          aria-label="New tab"
        >
          <Plus size={12} />
        </button>
        {onClose && (
          <button
            type="button"
            className="claude-panel-close-btn"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <ClaudeTerminalInstance
        key={panelActiveTabId}
        directory={directory}
        sessionStorageKey={sessionStorageKey}
        mode={mode}
        tabId={panelActiveTabId}
        onOutput={onTerminalOutput}
      />
    </div>
  )
}

// ── Terminal cleanup helper ──
function runTerminalCleanups(cleanupRef: React.MutableRefObject<Array<() => void>>) {
  for (const cleanup of cleanupRef.current) cleanup()
  cleanupRef.current = []
}

// ── Session listener setup ──
function setupSessionListeners(
  session: PersistedSession,
  managed: ManagedTerminal,
  terminalRef: React.MutableRefObject<ManagedTerminal | null>,
  processIdRef: React.MutableRefObject<string | null>,
  onOutput?: () => void
): () => void {
  processIdRef.current = session.processId
  session.outputChunks.forEach(chunk => managed.terminal.write(chunk))
  const listener = (
    event: { type: 'output'; chunk: string } | { type: 'closed'; exitCode: number | null }
  ) => {
    if (terminalRef.current?.terminal !== managed.terminal) {
      return
    }
    if (event.type === 'output') {
      managed.writeBuffered(event.chunk)
      onOutput?.()
      return
    }
    managed.terminal.writeln('\r\n\u001b[33m[claude session ended]\u001b[0m')
  }
  session.listeners.add(listener)
  return () => {
    session.listeners.delete(listener)
  }
}

// ── Single terminal instance ──
// Extracted so it can be rendered independently for tabs and split panels.

function ClaudeTerminalInstance({
  directory,
  sessionStorageKey,
  mode,
  tabId,
  onOutput,
}: {
  directory: string
  sessionStorageKey: string
  mode: 'standard' | 'full'
  tabId: string
  onOutput?: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<ManagedTerminal | null>(null)
  const processIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<Array<() => void>>([])

  const launchTerminal = useCallback(() => {
    const container = containerRef.current
    if (!container || !window.orxa?.claudeTerminal) return

    runTerminalCleanups(cleanupRef)
    if (terminalRef.current) {
      terminalRef.current.dispose()
      terminalRef.current = null
    }
    container.innerHTML = ''

    const managed = createManagedTerminal(container, TERMINAL_OPTIONS)
    const terminal = managed.terminal
    terminalRef.current = managed

    const cleanups: Array<() => void> = []
    const key = sessionKey(sessionStorageKey, mode, tabId)
    let detached = false

    void getOrCreateClaudeSession(key, directory, mode, terminal.cols, terminal.rows).then(
      session => {
        if (detached) return
        cleanups.push(setupSessionListeners(session, managed, terminalRef, processIdRef, onOutput))
        void window.orxa?.claudeTerminal?.resize(session.processId, terminal.cols, terminal.rows)
      }
    )
    cleanups.push(() => {
      detached = true
    })

    const disposeInput = terminal.onData(data => {
      const pid = processIdRef.current
      if (pid && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.write(pid, data)
      }
    })
    cleanups.push(() => disposeInput.dispose())

    const resizeObs = new ResizeObserver(() => {
      managed.refit()
      const pid = processIdRef.current
      if (pid && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.resize(pid, terminal.cols, terminal.rows)
      }
    })
    resizeObs.observe(container)
    cleanups.push(() => resizeObs.disconnect())

    cleanupRef.current = cleanups
    requestAnimationFrame(() => terminal.focus())
  }, [directory, mode, onOutput, sessionStorageKey, tabId])

  useEffect(() => {
    launchTerminal()
    return () => cleanupTerminalInstance(cleanupRef, terminalRef, processIdRef)
  }, [launchTerminal])

  return <div className="claude-terminal-body" ref={containerRef} />
}

function cleanupTerminalInstance(
  cleanupRef: React.MutableRefObject<Array<() => void>>,
  terminalRef: React.MutableRefObject<ManagedTerminal | null>,
  processIdRef: React.MutableRefObject<string | null>
) {
  runTerminalCleanups(cleanupRef)
  if (terminalRef.current) {
    terminalRef.current.dispose()
    terminalRef.current = null
  }
  processIdRef.current = null
}

export function ClaudeTerminalPane({
  directory,
  sessionStorageKey,
  onExit,
  onFirstInteraction,
}: Props) {
  const {
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
  } = useClaudeTerminalPaneState({ directory, sessionStorageKey, onFirstInteraction })
  const activePermissionMode: Exclude<PermissionMode, 'pending'> =
    permissionMode === 'full' ? 'full' : 'standard'

  const panelContent = (
    <div
      className={`claude-split-container ${splitMode === 'horizontal' ? 'claude-split-horizontal' : ''} ${splitMode === 'vertical' ? 'claude-split-vertical' : ''}`}
    >
        <ClaudePanelInstance
          directory={directory}
          sessionStorageKey={sessionStorageKey}
          mode={activePermissionMode}
          onAllTabsClosed={onExit}
          onTerminalOutput={handleTerminalOutput}
        />
      {splitMode !== 'none' && (
        <>
          <div className="claude-split-divider" />
          <ClaudePanelInstance
            key={splitPanelKey}
            directory={directory}
            sessionStorageKey={sessionStorageKey}
            mode={activePermissionMode}
            onClose={handleUnsplit}
            onTerminalOutput={handleTerminalOutput}
          />
        </>
      )}
    </div>
  )

  return (
    <ClaudeTerminalPaneView
      directory={directory}
      unavailable={unavailable}
      permissionMode={permissionMode}
      rememberChoice={rememberChoice}
      onRememberChoiceChange={setRememberChoice}
      onPermissionChoice={handlePermissionChoice}
      onExit={onExit}
      splitMode={splitMode}
      showSplitMenu={showSplitMenu}
      onToggleSplitMenu={() => setShowSplitMenu(value => !value)}
      onSplit={handleSplit}
      onUnsplit={handleUnsplit}
      panelContent={panelContent}
    />
  )
}

export { ClaudeBackgroundSessionManager } from './ClaudeBackgroundSessionManager'
