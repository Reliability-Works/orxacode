import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalTile } from './TerminalTile'
import type { CanvasTile, CanvasTheme } from '../../types/canvas'

const terminalWriteMocks: Array<ReturnType<typeof vi.fn>> = []
let eventSubscriptionListener:
  | ((event: { type: string; payload: Record<string, unknown> }) => void)
  | null = null
const serializeMock = vi.fn(() => '\u001b[31mserialized prompt\u001b[0m')

vi.mock('xterm', () => {
  function Terminal() {
    const write = vi.fn()
    terminalWriteMocks.push(write)
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write,
      writeln: vi.fn(),
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          length: 2,
          getLine: (index: number) =>
            [
              { translateToString: () => 'prompt line' },
              { translateToString: () => 'typed input' },
            ][index],
        },
      },
      unicode: { activeVersion: '6' },
    }
  }

  return { Terminal }
})

vi.mock('xterm-addon-fit', () => {
  function FitAddon() {
    return { fit: vi.fn() }
  }

  return { FitAddon }
})

vi.mock('xterm-addon-unicode11', () => ({
  Unicode11Addon: function Unicode11Addon() {
    return {}
  },
}))

vi.mock('xterm-addon-webgl', () => ({
  WebglAddon: function WebglAddon() {
    return {
      onContextLoss: vi.fn(),
      dispose: vi.fn(),
    }
  },
}))

vi.mock('xterm-addon-serialize', () => ({
  SerializeAddon: function SerializeAddon() {
    return { serialize: serializeMock }
  },
}))

vi.mock('xterm/css/xterm.css', () => ({}))

vi.mock('../CanvasTile', () => ({
  CanvasTileComponent: ({
    children,
    label,
    metadata,
    onRemove,
  }: {
    children: ReactNode
    label: string
    metadata?: string
    onRemove?: () => void
  }) => (
    <div>
      <div>{label}</div>
      {metadata ? <div>{metadata}</div> : null}
      <button type="button" onClick={onRemove}>
        remove
      </button>
      {children}
    </div>
  ),
}))

class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const DEFAULT_THEME: CanvasTheme = {
  preset: 'midnight',
  background: '#0C0C0C',
  tileBorder: '#1F1F1F',
  accent: '#22C55E',
}

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: 'terminal-1',
    type: 'terminal',
    x: 40,
    y: 40,
    width: 560,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { directory: '/workspace/project', cwd: '/workspace/project' },
    ...overrides,
  }
}

function renderTerminalTile(tileOverrides: Partial<CanvasTile> = {}) {
  const onUpdate = vi.fn()
  const onRemove = vi.fn()
  const view = render(
    <TerminalTile
      tile={makeTile(tileOverrides)}
      canvasTheme={DEFAULT_THEME}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={vi.fn()}
    />
  )
  return { ...view, onUpdate, onRemove }
}

function registerTerminalTileConnectionTests() {
  it('retries transient PTY connect failures before subscribing to output', async () => {
    const connectMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unexpected server response: 500'))
      .mockResolvedValue({ connected: true, ptyID: 'pty-1', directory: '/workspace/project' })

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-1' })),
          connect: connectMock,
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })

    renderTerminalTile()

    await waitFor(
      () => {
        expect(connectMock).toHaveBeenCalledTimes(2)
      },
      { timeout: 4000 }
    )

    expect(window.orxa.events.subscribe).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(window.orxa.terminal.resize).toHaveBeenCalledWith(
        '/workspace/project',
        'pty-1',
        80,
        24
      )
    })
    await waitFor(() => {
      expect(screen.queryByText('Connecting terminal...')).not.toBeInTheDocument()
    })
  })

  it('shows a visible error when PTY connect never succeeds', async () => {
    const connectMock = vi.fn(async () => {
      throw new Error('Unexpected server response: 500')
    })

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-1' })),
          connect: connectMock,
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })

    renderTerminalTile()

    await waitFor(
      () => {
        expect(screen.getByText('Unexpected server response: 500')).toBeInTheDocument()
      },
      { timeout: 4000 }
    )

    expect(connectMock).toHaveBeenCalledTimes(5)
    expect(window.orxa.events.subscribe).not.toHaveBeenCalled()
  })
}

function registerTerminalTileReuseTests() {
  it('reuses a persisted canvas PTY instead of creating a new one', async () => {
    const listMock = vi.fn(async () => [
      {
        id: 'pty-existing',
        directory: '/workspace/project',
        cwd: '/workspace/project',
        title: 'Terminal',
        owner: 'canvas',
        status: 'running',
        pid: 123,
        exitCode: null,
        createdAt: Date.now(),
      },
    ])
    const createMock = vi.fn(async () => ({ id: 'pty-new' }))
    const connectMock = vi.fn(async () => ({
      connected: true,
      ptyID: 'pty-existing',
      directory: '/workspace/project',
    }))

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: listMock,
          create: createMock,
          connect: connectMock,
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })

    renderTerminalTile({
      meta: { directory: '/workspace/project', cwd: '/workspace/project', ptyId: 'pty-existing' },
    })

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledWith('/workspace/project', 'pty-existing')
    })
    expect(listMock).toHaveBeenCalledWith('/workspace/project', 'canvas')
    expect(createMock).not.toHaveBeenCalled()
  })
}

function registerTerminalTileLifecycleTests() {
  it('does not close the PTY when the tile unmounts during session switches', async () => {
    const closeMock = vi.fn(async () => true)

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-1' })),
          connect: vi.fn(async () => ({
            connected: true,
            ptyID: 'pty-1',
            directory: '/workspace/project',
          })),
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: closeMock,
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    })

    const view = renderTerminalTile()
    await waitFor(() => {
      expect(window.orxa.terminal.connect).toHaveBeenCalled()
    })

    view.onUpdate.mockClear()
    view.unmount()
    expect(closeMock).not.toHaveBeenCalled()
    expect(view.onUpdate).not.toHaveBeenCalled()
  })

  it('closes the PTY when the tile is explicitly removed', async () => {
    const closeMock = vi.fn(async () => true)

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-1' })),
          connect: vi.fn(async () => ({
            connected: true,
            ptyID: 'pty-1',
            directory: '/workspace/project',
          })),
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: closeMock,
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })

    renderTerminalTile({
      meta: { directory: '/workspace/project', cwd: '/workspace/project', ptyId: 'pty-1' },
    })
    await waitFor(() => {
      expect(window.orxa.terminal.connect).toHaveBeenCalled()
    })

    screen.getByRole('button', { name: 'remove' }).click()
    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith('/workspace/project', 'pty-1')
    })
  })
}

function registerTerminalTilePersistenceTests() {
  it('persists a screen snapshot while output is flowing', async () => {
    const view = renderTerminalTile({
      meta: { directory: '/workspace/project', cwd: '/workspace/project', ptyId: 'pty-1' },
    })

    await waitFor(() => {
      expect(window.orxa.events.subscribe).toHaveBeenCalled()
    })

    view.onUpdate.mockClear()
    eventSubscriptionListener?.({
      type: 'pty.output',
      payload: {
        ptyID: 'pty-1',
        directory: '/workspace/project',
        chunk: 'prompt update',
      },
    })
    await waitFor(() => {
      expect(view.onUpdate).toHaveBeenCalledWith('terminal-1', {
        meta: {
          directory: '/workspace/project',
          cwd: '/workspace/project',
          ptyId: 'pty-1',
          serializedOutput: '\u001b[31mserialized prompt\u001b[0m',
        },
      })
    })
  })

  it('restores a saved output replay before reconnecting', async () => {
    renderTerminalTile({
      meta: {
        directory: '/workspace/project',
        cwd: '/workspace/project',
        ptyId: 'pty-existing',
        serializedOutput: '\u001b[31mrestored prompt\u001b[0m',
      },
    })

    await waitFor(() => {
      expect(window.orxa.terminal.connect).toHaveBeenCalled()
    })

    expect(terminalWriteMocks.at(-1)).toHaveBeenCalledWith('\u001b[31mrestored prompt\u001b[0m')
  })
}

function registerTerminalTileStartupCommandTests() {
  it('bootstraps claude code tiles through the claude CLI startup command', async () => {
    renderTerminalTile({
      type: 'claude_code',
      meta: {
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand:
          'env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude\n',
        startupFilter: 'claude',
      },
    })

    await waitFor(() => {
      expect(window.orxa.terminal.write).toHaveBeenCalledWith(
        '/workspace/project',
        'pty-1',
        'env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude\n'
      )
    })
  })

  it('bootstraps codex and opencode canvas tiles through terminal startup commands', async () => {
    renderTerminalTile({
      type: 'codex_cli',
      meta: {
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand: 'codex\n',
      },
    })

    await waitFor(() => {
      expect(window.orxa.terminal.write).toHaveBeenCalledWith(
        '/workspace/project',
        'pty-1',
        'codex\n'
      )
    })

    vi.clearAllMocks()
    terminalWriteMocks.length = 0
    eventSubscriptionListener = null
    serializeMock.mockClear()

    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-2' })),
          connect: vi.fn(async () => ({
            connected: true,
            ptyID: 'pty-2',
            directory: '/workspace/project',
          })),
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })

    renderTerminalTile({
      id: 'terminal-2',
      type: 'opencode_cli',
      meta: {
        directory: '/workspace/project',
        cwd: '/workspace/project',
        startupCommand: 'opencode\n',
      },
    })

    await waitFor(() => {
      expect(window.orxa.terminal.write).toHaveBeenCalledWith(
        '/workspace/project',
        'pty-2',
        'opencode\n'
      )
    })
  })
}

describe('TerminalTile', () => {
  beforeEach(() => {
    terminalWriteMocks.length = 0
    eventSubscriptionListener = null
    serializeMock.mockClear()
    vi.useRealTimers()
    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        terminal: {
          list: vi.fn(async () => []),
          create: vi.fn(async () => ({ id: 'pty-1' })),
          connect: vi.fn(async () => ({
            connected: true,
            ptyID: 'pty-1',
            directory: '/workspace/project',
          })),
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(listener => {
            eventSubscriptionListener = listener
            return vi.fn()
          }),
        },
      },
    })
  })

  registerTerminalTileConnectionTests()
  registerTerminalTileReuseTests()
  registerTerminalTileLifecycleTests()
  registerTerminalTilePersistenceTests()
  registerTerminalTileStartupCommandTests()
})
