import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import 'xterm/css/xterm.css'
import { createManagedTerminal, type ManagedTerminal } from '../../lib/xterm-terminal'

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

type Props = {
  workspaceDir: string
  taskId: string
  open: boolean
  onClose: () => void
}

type TerminalConnection = { ptyID: string; directory: string }

const TERMINAL_OPTIONS = {
  fontSize: 12,
  lineHeight: 1.3,
  theme: TERMINAL_THEME,
  cursorBlink: true,
  scrollback: 5000,
}

function fitAndResizeTerminal(
  managed: ManagedTerminal,
  connection: TerminalConnection | null
): void {
  if (!connection) return
  managed.refit()
  const dims = managed.fit.proposeDimensions()
  if (dims) {
    void window.orxa.terminal.resize(connection.directory, connection.ptyID, dims.cols, dims.rows)
  }
}

function createPTYOutputHandler(
  managed: ManagedTerminal,
  connectionRef: React.MutableRefObject<TerminalConnection | null>,
  terminalClosedRef: React.MutableRefObject<boolean>,
  setStatus: (status: 'connecting' | 'ready' | 'error') => void
) {
  return (event: { type: string; payload?: unknown }) => {
    if (event.type === 'pty.output') {
      const payload = event.payload as { ptyID: string; directory: string; chunk: string }
      if (
        payload.ptyID === connectionRef.current?.ptyID &&
        payload.directory === connectionRef.current?.directory
      ) {
        managed.writeBuffered(payload.chunk)
      }
    }
    if (event.type === 'pty.closed') {
      const payload = event.payload as { ptyID: string; directory: string }
      if (payload.ptyID === connectionRef.current?.ptyID) {
        terminalClosedRef.current = true
        setStatus('error')
      }
    }
  }
}

function wireTerminalInput(
  managed: ManagedTerminal,
  connectionRef: React.MutableRefObject<TerminalConnection | null>
): () => void {
  const inputDisposable = managed.terminal.onData(data => {
    if (connectionRef.current) {
      void window.orxa.terminal.write(
        connectionRef.current.directory,
        connectionRef.current.ptyID,
        data
      )
    }
  })
  return () => inputDisposable.dispose()
}

export function KanbanTaskTerminal({ workspaceDir, taskId, open, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const managedRef = useRef<ManagedTerminal | null>(null)
  const connectionRef = useRef<TerminalConnection | null>(null)
  const terminalClosedRef = useRef(true)
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')

  const closeTaskTerminal = useCallback(async () => {
    if (terminalClosedRef.current) {
      return
    }
    terminalClosedRef.current = true
    await window.orxa.kanban.closeTaskTerminal(workspaceDir, taskId).catch(() => undefined)
  }, [taskId, workspaceDir])

  const handleClose = useCallback(() => {
    void closeTaskTerminal()
    onClose()
  }, [closeTaskTerminal, onClose])

  useEffect(() => {
    if (!open) return

    let disposed = false
    const cleanups: Array<() => void> = []
    terminalClosedRef.current = true

    void (async () => {
      try {
        setStatus('connecting')

        // Get or create terminal
        const existingTerminal = await window.orxa.kanban.getTaskTerminal(workspaceDir, taskId)
        if (!existingTerminal) {
          await window.orxa.kanban.createTaskTerminal(workspaceDir, taskId)
        }

        // Connect
        const connection = await window.orxa.kanban.connectTaskTerminal(workspaceDir, taskId)
        if (disposed) return

        connectionRef.current = { ptyID: connection.ptyID, directory: connection.directory }
        terminalClosedRef.current = false

        // Create xterm instance
        if (!containerRef.current) return
        const managed = createManagedTerminal(containerRef.current, TERMINAL_OPTIONS)
        managedRef.current = managed

        // Wire input -> PTY
        cleanups.push(wireTerminalInput(managed, connectionRef))

        // Wire PTY output -> xterm
        cleanups.push(
          window.orxa.events.subscribe(
            createPTYOutputHandler(managed, connectionRef, terminalClosedRef, setStatus)
          )
        )

        // Resize observer
        const observer = new ResizeObserver(() =>
          fitAndResizeTerminal(managed, connectionRef.current)
        )
        observer.observe(containerRef.current)
        cleanups.push(() => observer.disconnect())

        // Initial fit
        fitAndResizeTerminal(managed, connectionRef.current)

        setStatus('ready')
      } catch {
        if (!disposed) setStatus('error')
      }
    })()

    return () => {
      disposed = true
      for (const cleanup of cleanups) cleanup()
      managedRef.current?.dispose()
      managedRef.current = null
      connectionRef.current = null
      void closeTaskTerminal()
    }
  }, [closeTaskTerminal, open, workspaceDir, taskId])

  if (!open) return null

  return (
    <div className="kanban-task-terminal">
      <div className="kanban-task-terminal-header">
        <span>
          Terminal{' '}
          {status === 'connecting' ? '(connecting…)' : status === 'error' ? '(disconnected)' : ''}
        </span>
        <button
          type="button"
          className="kanban-icon-btn"
          onClick={handleClose}
          title="Close terminal"
        >
          <X size={12} />
        </button>
      </div>
      <div className="kanban-task-terminal-body" ref={containerRef} />
    </div>
  )
}
