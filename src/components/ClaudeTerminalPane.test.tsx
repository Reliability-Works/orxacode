import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ClaudeTerminalPane } from './ClaudeTerminalPane'
import { consumeClaudeStartupChunk } from '../lib/claude-terminal-startup'

// xterm uses DOM APIs not available in jsdom — mock it
vi.mock('xterm', () => {
  function Terminal() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      writeln: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      reset: vi.fn(),
      cols: 80,
      rows: 24,
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

vi.mock('xterm/css/xterm.css', () => ({}))

// ResizeObserver is not in jsdom — use a proper constructor
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const mockOnExit = vi.fn()

function buildClaudeTerminal() {
  return {
    create: vi.fn(async () => ({ processId: 'claude-proc-1', directory: '/workspace/project' })),
    write: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    close: vi.fn(async () => true),
  }
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  }
}

function renderClaudeTerminalPane(directory = '/workspace/project') {
  return render(
    <ClaudeTerminalPane
      directory={directory}
      sessionStorageKey={`${directory}::claude-session`}
      onExit={mockOnExit}
    />
  )
}

function setClaudeTerminalWindow() {
  window.orxa = {
    claudeTerminal: buildClaudeTerminal(),
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa
}

function showClaudeTerminal() {
  renderClaudeTerminalPane()
  fireEvent.click(screen.getByText('Standard Mode'))
}

function registerPermissionModalTests() {
  it('renders permission modal when no stored preference', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()

    expect(screen.getByText('Claude Code Permissions')).toBeInTheDocument()
    expect(screen.getByText('Standard Mode')).toBeInTheDocument()
    expect(screen.getByText('Full Access Mode')).toBeInTheDocument()
  })

  it('renders toolbar with claude code label in permission modal state', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()

    expect(screen.getByText('claude code')).toBeInTheDocument()
  })

  it('renders workspace directory path in toolbar', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane('/workspace/my-project')

    expect(screen.getByText('/workspace/my-project')).toBeInTheDocument()
  })
}

function registerPermissionPersistenceTests() {
  it('launches terminal after choosing standard mode', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()
    fireEvent.click(screen.getByText('Standard Mode'))

    expect(screen.queryByText('Claude Code Permissions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument()
  })

  it('launches terminal after choosing full access mode', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()
    fireEvent.click(screen.getByText('Full Access Mode'))

    expect(screen.queryByText('Claude Code Permissions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument()
  })

  it('remembers choice when checkbox is checked', () => {
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()
    fireEvent.click(screen.getByText('Remember this choice for this workspace'))
    fireEvent.click(screen.getByText('Standard Mode'))

    expect(localStorage.getItem('claude-permission-mode:/workspace/project')).toBe('standard')
  })

  it('skips modal when stored preference exists', () => {
    localStorage.setItem('claude-permission-mode:/workspace/project', 'full')
    setClaudeTerminalWindow()
    renderClaudeTerminalPane()
    expect(screen.queryByText('Claude Code Permissions')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /split/i })).toBeInTheDocument()
  })

  it('keeps the selected mode for the same session without requiring remember choice', () => {
    setClaudeTerminalWindow()
    const view = renderClaudeTerminalPane()
    fireEvent.click(screen.getByText('Standard Mode'))

    expect(screen.queryByText('Claude Code Permissions')).not.toBeInTheDocument()

    view.unmount()
    renderClaudeTerminalPane()
    expect(screen.queryByText('Claude Code Permissions')).not.toBeInTheDocument()
  })
}

function registerUnavailableStateTests() {
  it('shows unavailable message when claude terminal API is not available', () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa

    localStorage.setItem('claude-permission-mode:/workspace/project', 'standard')
    renderClaudeTerminalPane()

    expect(screen.getByText(/terminal api is not available/i)).toBeInTheDocument()
  })

  it('shows exit button in unavailable state', () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa

    localStorage.setItem('claude-permission-mode:/workspace/project', 'standard')
    renderClaudeTerminalPane()

    expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument()
  })
}

function registerTabTests() {
  it('shows tab bar with initial tab after choosing mode', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()
    const tabBar = document.querySelector('.claude-panel-tab-bar')
    expect(tabBar).toBeInTheDocument()
  })

  it('adds a new tab when + button is clicked', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()

    const addBtn = screen.getByRole('button', { name: /new tab/i })
    fireEvent.click(addBtn)

    const tabs = document.querySelectorAll('.claude-tab:not(.claude-tab-add)')
    expect(tabs.length).toBe(2)
  })

  it('switches active tab when clicked', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()
    const addBtn = screen.getByRole('button', { name: /new tab/i })
    fireEvent.click(addBtn)

    const tabs = document.querySelectorAll('.claude-tab:not(.claude-tab-add)')
    expect(tabs.length).toBe(2)

    fireEvent.click(tabs[0])
    expect(tabs[0].classList.contains('active')).toBe(true)
  })
}

function registerSplitViewTests() {
  it('shows split menu when split button is clicked', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()

    const splitBtn = screen.getByRole('button', { name: /split/i })
    fireEvent.click(splitBtn)

    expect(screen.getByText('Split horizontal')).toBeInTheDocument()
    expect(screen.getByText('Split vertical')).toBeInTheDocument()
  })

  it('creates a split view when horizontal split is selected', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()

    const splitBtn = screen.getByRole('button', { name: /split/i })
    fireEvent.click(splitBtn)
    fireEvent.click(screen.getByText('Split horizontal'))

    const container = document.querySelector('.claude-split-container')
    expect(container?.classList.contains('claude-split-horizontal')).toBe(true)

    const panels = document.querySelectorAll('.claude-split-panel')
    expect(panels.length).toBe(2)
  })

  it('creates a split view when vertical split is selected', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()

    const splitBtn = screen.getByRole('button', { name: /split/i })
    fireEvent.click(splitBtn)
    fireEvent.click(screen.getByText('Split vertical'))

    const container = document.querySelector('.claude-split-container')
    expect(container?.classList.contains('claude-split-vertical')).toBe(true)

    const panels = document.querySelectorAll('.claude-split-panel')
    expect(panels.length).toBe(2)
  })

  it('shows unsplit option when already split', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()
    const splitBtn = screen.getByRole('button', { name: /split/i })
    fireEvent.click(splitBtn)
    fireEvent.click(screen.getByText('Split horizontal'))

    fireEvent.click(splitBtn)
    expect(screen.getByText('Unsplit')).toBeInTheDocument()
  })

  it('removes split when unsplit is selected', () => {
    setClaudeTerminalWindow()
    showClaudeTerminal()
    const splitBtn = screen.getByRole('button', { name: /split/i })
    fireEvent.click(splitBtn)
    fireEvent.click(screen.getByText('Split horizontal'))

    fireEvent.click(splitBtn)
    fireEvent.click(screen.getByText('Unsplit'))

    const panels = document.querySelectorAll('.claude-split-panel')
    expect(panels.length).toBe(1)
  })
}

function registerStartupBridgeTests() {
  it('starts Claude through the dedicated Claude terminal bridge', async () => {
    const claudeTerminal = buildClaudeTerminal()
    window.orxa = {
      claudeTerminal,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa

    render(
      <ClaudeTerminalPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::claude-session"
        onExit={mockOnExit}
      />
    )
    fireEvent.click(screen.getByText('Standard Mode'))

    await waitFor(() => {
      expect(claudeTerminal.create).toHaveBeenCalledWith(
        '/workspace/project',
        'standard',
        expect.any(Number),
        expect.any(Number)
      )
      expect(claudeTerminal.write).toHaveBeenCalledWith(
        'claude-proc-1',
        expect.stringContaining('exec env -u ANTHROPIC_BASE_URL')
      )
    })
  })

  it('suppresses only the echoed bootstrap command', () => {
    const first = consumeClaudeStartupChunk(
      [],
      '{"cursor":0}exec env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions\n',
      false
    )
    expect(first.displayChunk).toBeNull()
    expect(first.startupReady).toBe(false)

    const second = consumeClaudeStartupChunk(
      first.startupBuffer,
      '╭─ Claude Code\n',
      first.startupReady
    )
    expect(second.displayChunk).toContain('Claude Code')
    expect(second.displayChunk).not.toContain('exec env')
  })

  it('suppresses the ANSI-colored shell echo of the bootstrap command', () => {
    const first = consumeClaudeStartupChunk(
      [],
      '\u001b[32m➜\u001b[39m  dreamweaver exec env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions\n',
      false
    )
    expect(first.displayChunk).toBeNull()
    expect(first.startupReady).toBe(false)

    const second = consumeClaudeStartupChunk(
      first.startupBuffer,
      '╭─ Claude Code v2.1.80\n',
      first.startupReady
    )
    expect(second.displayChunk).toContain('Claude Code')
    expect(second.displayChunk).not.toContain('dreamweaver exec env')
  })

  it('buffers partial bootstrap chunks until a full non-command line arrives', () => {
    const first = consumeClaudeStartupChunk(
      [],
      'exec env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY ',
      false
    )
    expect(first.displayChunk).toBeNull()
    expect(first.startupReady).toBe(false)

    const second = consumeClaudeStartupChunk(
      first.startupBuffer,
      'claude --dangerously-skip-permissions\n\u001b[32m➜\u001b[39m dreamweaver exec env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions\n',
      first.startupReady
    )
    expect(second.displayChunk).toBeNull()
    expect(second.startupReady).toBe(false)

    const third = consumeClaudeStartupChunk(
      second.startupBuffer,
      '╭─ Claude Code v2.1.80\n',
      second.startupReady
    )
    expect(third.startupReady).toBe(true)
    expect(third.displayChunk).toContain('Claude Code')
    expect(third.displayChunk).not.toContain('exec env')
  })
}

describe('ClaudeTerminalPane', () => {
  beforeEach(() => {
    mockOnExit.mockReset()
    localStorage.clear()
    ;(
      globalThis as typeof globalThis & {
        __resetClaudeTerminalPaneStateForTests?: () => void
      }
    ).__resetClaudeTerminalPaneStateForTests?.()
  })

  afterEach(() => {
    // Remove window.orxa after each test
    // @ts-expect-error test teardown
    delete window.orxa
  })

  registerPermissionModalTests()
  registerPermissionPersistenceTests()
  registerUnavailableStateTests()
  registerTabTests()
  registerSplitViewTests()
  registerStartupBridgeTests()
})
