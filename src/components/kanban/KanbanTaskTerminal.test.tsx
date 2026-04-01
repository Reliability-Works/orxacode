import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KanbanTaskTerminal } from './KanbanTaskTerminal'

vi.mock('xterm', () => {
  function Terminal() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      writeln: vi.fn(),
      cols: 80,
      rows: 24,
      unicode: { activeVersion: '6' },
    }
  }
  return { Terminal }
})

vi.mock('xterm-addon-fit', () => {
  function FitAddon() {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    }
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

vi.mock('xterm/css/xterm.css', () => ({}))

class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

describe('KanbanTaskTerminal', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        kanban: {
          getTaskTerminal: vi.fn(async () => null),
          createTaskTerminal: vi.fn(async () => ({
            id: 'pty-1',
            directory: '/repo/kanban',
            cwd: '/repo/kanban',
            title: 'Kanban terminal',
            owner: 'kanban',
            status: 'running',
            pid: 1,
            exitCode: null,
            createdAt: Date.now(),
          })),
          connectTaskTerminal: vi.fn(async () => ({
            ptyID: 'pty-1',
            directory: '/repo/kanban',
            connected: true,
          })),
          closeTaskTerminal: vi.fn(async () => true),
        },
        terminal: {
          write: vi.fn(async () => true),
          resize: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    })
  })

  it('closes the backend task terminal when the close button is used', async () => {
    const onClose = vi.fn()
    const view = render(
      <KanbanTaskTerminal workspaceDir="/repo/kanban" taskId="task-1" open onClose={onClose} />
    )

    await waitFor(() => {
      expect(window.orxa.kanban.connectTaskTerminal).toHaveBeenCalledWith('/repo/kanban', 'task-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    await waitFor(() => {
      expect(window.orxa.kanban.closeTaskTerminal).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    view.unmount()

    await waitFor(() => {
      expect(window.orxa.kanban.closeTaskTerminal).toHaveBeenCalledTimes(1)
    })
  })

  it('closes the backend task terminal when the component unmounts', async () => {
    const view = render(
      <KanbanTaskTerminal workspaceDir="/repo/kanban" taskId="task-1" open onClose={vi.fn()} />
    )

    await waitFor(() => {
      expect(window.orxa.kanban.connectTaskTerminal).toHaveBeenCalledWith('/repo/kanban', 'task-1')
    })

    view.unmount()

    await waitFor(() => {
      expect(window.orxa.kanban.closeTaskTerminal).toHaveBeenCalledTimes(1)
    })
  })
})
