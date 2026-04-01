import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react'
import 'xterm/css/xterm.css'
import { Plus, X } from 'lucide-react'
import { createManagedTerminal, type ManagedTerminal } from '../lib/xterm-terminal'

export type TerminalTab = {
  id: string
  label: string
}

type TerminalInstance = {
  managed: ManagedTerminal
  cleanups: Array<() => void>
}

type Props = {
  directory: string
  tabs: TerminalTab[]
  activeTabId: string | undefined
  open: boolean
  height?: number
  onCreateTab: () => Promise<void>
  onCloseTab: (ptyId: string) => Promise<void>
  onSwitchTab: (ptyId: string) => void
  onResizeStart?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#E5E5E5',
  cursor: '#22C55E',
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

function sanitizeTerminalChunk(chunk: string) {
  const sanitized = chunk.replace(/\{"cursor":\d+\}/g, '')
  return sanitized.trim() === '%' ? '' : sanitized
}

export function TerminalPanel({
  directory,
  tabs,
  activeTabId,
  open,
  height,
  onCreateTab,
  onCloseTab,
  onSwitchTab,
  onResizeStart,
}: Props) {
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map())
  const containerMapRef = useRef<Map<string, HTMLDivElement | null>>(new Map())
  useTerminalLifecycle({
    activeTabId,
    containerMapRef,
    directory,
    height,
    instancesRef,
    open,
    tabs,
  })

  return (
    <section
      className={`terminal-panel ${open ? 'open' : 'closed'}`}
      style={
        open && typeof height === 'number'
          ? { height: `${height}px`, maxHeight: `${height}px` }
          : undefined
      }
    >
      {open ? (
        <button
          type="button"
          className="terminal-resize-handle"
          onMouseDown={onResizeStart}
          aria-label="Resize integrated terminal"
        />
      ) : null}
      <TerminalTabsHeader
        activeTabId={activeTabId}
        onCloseTab={onCloseTab}
        onCreateTab={onCreateTab}
        onSwitchTab={onSwitchTab}
        tabs={tabs}
      />
      <TerminalBodyInstances activeTabId={activeTabId} containerMapRef={containerMapRef} tabs={tabs} />
    </section>
  )
}

type TerminalLifecycleInput = {
  activeTabId: string | undefined
  containerMapRef: MutableRefObject<Map<string, HTMLDivElement | null>>
  directory: string
  height: number | undefined
  instancesRef: MutableRefObject<Map<string, TerminalInstance>>
  open: boolean
  tabs: TerminalTab[]
}

function useTerminalLifecycle({
  activeTabId,
  containerMapRef,
  directory,
  height,
  instancesRef,
  open,
  tabs,
}: TerminalLifecycleInput) {
  useEffect(() => {
    if (!open || !activeTabId) return

    const container = containerMapRef.current.get(activeTabId)
    if (!container) return

    const existing = instancesRef.current.get(activeTabId)
    if (existing) {
      requestAnimationFrame(() => {
        existing.managed.refit()
        existing.managed.terminal.focus()
      })
      return
    }

    const nextInstance = createTerminalInstance({ activeTabId, container, directory })
    instancesRef.current.set(activeTabId, nextInstance)
    requestAnimationFrame(() => nextInstance.managed.terminal.focus())
  }, [activeTabId, containerMapRef, directory, instancesRef, open])

  useEffect(() => {
    if (!open || !activeTabId) return
    const instance = instancesRef.current.get(activeTabId)
    if (!instance) return
    requestAnimationFrame(() => {
      instance.managed.refit()
      void window.orxa.terminal.resize(
        directory,
        activeTabId,
        instance.managed.terminal.cols,
        instance.managed.terminal.rows
      )
    })
  }, [activeTabId, directory, height, instancesRef, open])

  useEffect(() => {
    const activeIds = new Set(tabs.map(t => t.id))
    for (const [id, instance] of instancesRef.current.entries()) {
      if (!activeIds.has(id)) {
        disposeTerminalInstance(instance)
        instancesRef.current.delete(id)
      }
    }
  }, [instancesRef, tabs])

  useEffect(() => {
    const instances = instancesRef.current
    return () => {
      for (const instance of instances.values()) {
        disposeTerminalInstance(instance)
      }
      instances.clear()
    }
  }, [instancesRef])
}

function createTerminalInstance({
  activeTabId,
  container,
  directory,
}: {
  activeTabId: string
  container: HTMLDivElement
  directory: string
}): TerminalInstance {
  const managed = createManagedTerminal(container, {
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 12,
    fontWeight: '300',
    fontWeightBold: '500',
    lineHeight: 1.4,
    cursorBlink: true,
    theme: TERMINAL_THEME,
  })
  const { terminal } = managed
  const cleanups: Array<() => void> = []

  void window.orxa.terminal.connect(directory, activeTabId).then(() => {
    void window.orxa.terminal.resize(directory, activeTabId, terminal.cols, terminal.rows)
    const unsubscribe = window.orxa.events.subscribe(event => {
      if (
        event.type === 'pty.output' &&
        event.payload.ptyID === activeTabId &&
        event.payload.directory === directory
      ) {
        const sanitizedChunk = sanitizeTerminalChunk(event.payload.chunk)
        if (sanitizedChunk) {
          managed.writeBuffered(sanitizedChunk)
        }
      }
      if (
        event.type === 'pty.closed' &&
        event.payload.ptyID === activeTabId &&
        event.payload.directory === directory
      ) {
        terminal.writeln('\r\n\u001b[33m[terminal closed]\u001b[0m')
      }
    })
    cleanups.push(unsubscribe)
  })

  const disposeInput = terminal.onData(data => {
    void window.orxa.terminal.write(directory, activeTabId, data)
  })
  cleanups.push(() => disposeInput.dispose())

  const resizeObserver = new ResizeObserver(() => {
    managed.refit()
    void window.orxa.terminal.resize(directory, activeTabId, terminal.cols, terminal.rows)
  })
  resizeObserver.observe(container)
  cleanups.push(() => resizeObserver.disconnect())

  return { managed, cleanups }
}

function disposeTerminalInstance(instance: TerminalInstance) {
  for (const cleanup of instance.cleanups) {
    cleanup()
  }
  instance.managed.dispose()
}

function TerminalTabsHeader({
  activeTabId,
  onCloseTab,
  onCreateTab,
  onSwitchTab,
  tabs,
}: {
  activeTabId: string | undefined
  onCloseTab: (ptyId: string) => Promise<void>
  onCreateTab: () => Promise<void>
  onSwitchTab: (ptyId: string) => void
  tabs: TerminalTab[]
}) {
  return (
    <header className="terminal-header">
      <div className="terminal-tabs">
        <button
          type="button"
          className="terminal-tab-add"
          onClick={() => void onCreateTab()}
          aria-label="New terminal tab"
        >
          <Plus size={13} />
        </button>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`terminal-tab ${activeTabId === tab.id ? 'active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
          >
            <span className="terminal-tab-label">{tab.label}</span>
            <span
              className="terminal-tab-close"
              onClick={e => {
                e.stopPropagation()
                void onCloseTab(tab.id)
              }}
              role="button"
              tabIndex={-1}
            >
              <X size={11} />
            </span>
          </button>
        ))}
        {tabs.length === 0 ? (
          <span className="terminal-empty-hint">Press + to create a terminal</span>
        ) : null}
      </div>
    </header>
  )
}

function TerminalBodyInstances({
  activeTabId,
  containerMapRef,
  tabs,
}: {
  activeTabId: string | undefined
  containerMapRef: MutableRefObject<Map<string, HTMLDivElement | null>>
  tabs: TerminalTab[]
}) {
  return (
    <div className="terminal-body-container">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`terminal-body-instance ${activeTabId === tab.id ? 'active' : ''}`}
          ref={el => {
            if (el) containerMapRef.current.set(tab.id, el)
            else containerMapRef.current.delete(tab.id)
          }}
        />
      ))}
    </div>
  )
}
