import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './WorkspaceSidebar'
import type { SessionType } from '../types/canvas'

afterEach(() => {
  cleanup()
})

const NOW = new Date('2026-03-26T10:00:00.000Z').getTime()

function buildProps(overrides: Partial<WorkspaceSidebarProps> = {}): WorkspaceSidebarProps {
  return {
    sidebarMode: 'projects',
    setSidebarMode: vi.fn(),
    unreadJobRunsCount: 0,
    updateAvailableVersion: null,
    isCheckingForUpdates: false,
    updateInstallPending: false,
    updateStatusMessage: null,
    onCheckForUpdates: vi.fn(),
    onDownloadAndInstallUpdate: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    projectSortOpen: false,
    setProjectSortOpen: vi.fn(),
    projectSortMode: 'updated',
    setProjectSortMode: vi.fn(),
    filteredProjects: [],
    activeProjectDir: undefined,
    collapsedProjects: {},
    setCollapsedProjects: vi.fn(),
    sessions: [],
    cachedSessionsByProject: undefined,
    hiddenSessionIDsByProject: undefined,
    pinnedSessionsByProject: undefined,
    activeSessionID: undefined,
    setAllSessionsModalOpen: vi.fn(),
    getSessionTitle: vi.fn((_, __, fallbackTitle) => fallbackTitle),
    getSessionType: vi.fn<WorkspaceSidebarProps['getSessionType']>(
      () => 'opencode' satisfies SessionType
    ),
    getSessionIndicator: vi.fn(() => 'none' as const),
    selectProject: vi.fn(),
    createSession: vi.fn(),
    openClaudeSessionBrowser: vi.fn(),
    openCodexSessionBrowser: vi.fn(),
    openSession: vi.fn(),
    togglePinSession: vi.fn(),
    archiveSession: vi.fn(),
    openProjectContextMenu: vi.fn(),
    openSessionContextMenu: vi.fn(),
    addProjectDirectory: vi.fn(),
    onOpenMemoryModal: vi.fn(),
    onOpenSearchModal: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    setSettingsOpen: vi.fn(),
    ...overrides,
  }
}

function registerWorkspaceSidebarUpdateBasicsTests() {
  it('shows a relative age chip based on session creation time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-fresh',
              slug: 'session-fresh',
              title: 'Fresh session',
              time: { created: NOW, updated: NOW },
            },
          ],
        })}
      />
    )

    expect(screen.getByLabelText('1m old')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('does not render an update card when no update is available', () => {
    render(<WorkspaceSidebar {...buildProps()} />)

    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })

  it('checks for updates when the update card is pressed', () => {
    const onCheckForUpdates = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: '0.1.0-beta.6',
          onCheckForUpdates,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /update available/i }))
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
  })

  it('shows update card and checks for updates when one is available', () => {
    const onCheckForUpdates = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: '0.1.0-beta.6',
          onCheckForUpdates,
        })}
      />
    )

    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('0.1.0-beta.6')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Update available').closest('button')!)
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
  })

  it('downloads the update when install is pending', () => {
    const onDownloadAndInstallUpdate = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: '0.1.0-beta.6',
          updateInstallPending: true,
          onDownloadAndInstallUpdate,
        })}
      />
    )

    const updatingButton = screen.getByRole('button', { name: /update available/i })
    fireEvent.click(updatingButton)
    expect(onDownloadAndInstallUpdate).toHaveBeenCalledTimes(1)
  })

  it('shows checking state while a check is in progress', () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: '0.1.0-beta.6',
          isCheckingForUpdates: true,
        })}
      />
    )

    const checkingButton = screen.getByRole('button', { name: /update available/i })
    expect(checkingButton).toBeDisabled()
  })

  it('does not render a legacy debug logs footer button', () => {
    const onOpenDebugLogs = vi.fn()
    render(<WorkspaceSidebar {...buildProps({ onOpenDebugLogs })} />)

    expect(screen.queryByRole('button', { name: 'Debug logs' })).not.toBeInTheDocument()
    expect(onOpenDebugLogs).not.toHaveBeenCalled()
  })

  it('opens the coming soon memory modal from the sidebar', () => {
    const onOpenMemoryModal = vi.fn()
    render(<WorkspaceSidebar {...buildProps({ onOpenMemoryModal })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(onOpenMemoryModal).toHaveBeenCalledTimes(1)
  })
}

function registerWorkspaceSidebarClaudeBrowserTests() {
  it('opens the Claude session browser from the new-session picker', () => {
    const openClaudeSessionBrowser = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          openClaudeSessionBrowser,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /create session for project/i }))
    fireEvent.click(screen.getByText('browse claude sessions'))
    expect(openClaudeSessionBrowser).toHaveBeenCalledWith('/workspace/project')
  })

  it('opens the Codex thread browser from the new-session picker', () => {
    const openCodexSessionBrowser = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          openCodexSessionBrowser,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /create session for project/i }))
    fireEvent.click(screen.getByText('browse codex threads'))
    expect(openCodexSessionBrowser).toHaveBeenCalledWith('/workspace/project')
  })
}

function registerWorkspaceSidebarUpdateIndicatorTests() {
  it('shows an experimental warning next to the Kanban mode entry', () => {
    render(<WorkspaceSidebar {...buildProps()} />)

    expect(screen.getByRole('button', { name: /Orxa KanBan/i })).toHaveTextContent('Experimental')
  })

  it('shows awaiting and unread indicators for session rows', () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-awaiting',
              slug: 'session-awaiting',
              title: 'Needs input',
              time: { created: NOW - 2_000, updated: 2 },
            },
            {
              id: 'session-unread',
              slug: 'session-unread',
              title: 'Unread output',
              time: { created: NOW - 2_000, updated: 3 },
            },
          ],
          getSessionIndicator: vi.fn(sessionID => {
            if (sessionID === 'session-awaiting') return 'awaiting'
            if (sessionID === 'session-unread') return 'unread'
            return 'none'
          }) as WorkspaceSidebarProps['getSessionIndicator'],
        })}
      />
    )

    expect(document.querySelector('.session-status-indicator.awaiting')?.textContent).toBe('!')
    expect(document.querySelector('.session-status-indicator.unread')).toBeInTheDocument()
  })
}

function registerWorkspaceSidebarSessionNavigationTests() {
  it('opens the workspace landing view when clicking the active workspace header from a session', () => {
    const selectProject = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          activeSessionID: 'session-1',
          selectProject,
          sessions: [
            {
              id: 'session-1',
              slug: 'session-1',
              title: 'Current session',
              time: { created: NOW - 2_000, updated: 1 },
            },
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'project' }))
    expect(selectProject).toHaveBeenCalledWith('/workspace/project')
  })

  it('routes session clicks through openSession with the target workspace', () => {
    const openSession = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/other',
          cachedSessionsByProject: {
            '/workspace/project': [
              {
                id: 'session-2',
                slug: 'session-2',
                title: 'Open me',
                time: { created: NOW - 2_000, updated: 2 },
              },
            ],
          },
          openSession,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open me' }))
    expect(openSession).toHaveBeenCalledWith('/workspace/project', 'session-2')
  })

  it('opens worktree sessions using their real directory while rendering under the root workspace row', () => {
    const openSession = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-root', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-worktree',
              directory: '/workspace/project/.worktrees/feature-a',
              slug: 'session-worktree',
              title: 'Feature session',
              time: { created: NOW - 2_000, updated: 2 },
            },
          ],
          openSession,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Feature session' }))
    expect(openSession).toHaveBeenCalledWith(
      '/workspace/project/.worktrees/feature-a',
      'session-worktree'
    )
  })
}

function registerWorkspaceSidebarPinnedSessionTests() {
  it('renders pinned sessions in a separate section above the workspace list', () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-pinned',
              slug: 'session-pinned',
              title: 'Pinned session',
              time: { created: NOW - 2_000, updated: 2 },
            },
          ],
          pinnedSessionsByProject: {
            '/workspace/project': ['session-pinned'],
          },
        })}
      />
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Pinned session' })).toHaveLength(1)
  })

  it('shows a session-type icon for rendered session rows', () => {
    const { container } = render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-canvas',
              slug: 'session-canvas',
              title: 'Canvas',
              time: { created: NOW - 2_000, updated: 2 },
            },
          ],
          getSessionType: vi.fn<WorkspaceSidebarProps['getSessionType']>(
            () => 'canvas' satisfies SessionType
          ),
        })}
      />
    )

    expect(container.querySelector('.session-type-icon--canvas')).toBeTruthy()
  })
}

function registerWorkspaceSidebarSessionActionsTests() {
  it('pins a session from the hover action', () => {
    const togglePinSession = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-pin',
              slug: 'session-pin',
              title: 'Pin me',
              time: { created: NOW - 2_000, updated: 2 },
            },
          ],
          togglePinSession,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin Pin me' }))
    expect(togglePinSession).toHaveBeenCalledWith('/workspace/project', 'session-pin')
  })

  it('archives a session from the hover action', () => {
    const archiveSession = vi.fn()
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-archive',
              slug: 'session-archive',
              title: 'Archive me',
              time: { created: NOW - 2_000, updated: 2 },
            },
          ],
          archiveSession,
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Archive Archive me' }))
    expect(archiveSession).toHaveBeenCalledWith('/workspace/project', 'session-archive')
  })

  it('hides background-agent session ids from the workspace session list', () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [
            { id: 'project-1', worktree: '/workspace/project', name: 'project', source: 'local' },
          ],
          activeProjectDir: '/workspace/project',
          sessions: [
            {
              id: 'session-main',
              slug: 'session-main',
              title: 'Main session',
              time: { created: NOW - 2_000, updated: 2 },
            },
            {
              id: 'session-subagent',
              slug: 'session-subagent',
              title: 'Subagent session',
              time: { created: NOW - 2_000, updated: 3 },
            },
          ],
          hiddenSessionIDsByProject: {
            '/workspace/project': ['session-subagent'],
          },
        })}
      />
    )

    expect(screen.getByRole('button', { name: 'Main session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subagent session' })).toBeNull()
  })
}

describe('WorkspaceSidebar update button', () => {
registerWorkspaceSidebarUpdateBasicsTests()
registerWorkspaceSidebarClaudeBrowserTests()
registerWorkspaceSidebarUpdateIndicatorTests()
  registerWorkspaceSidebarSessionNavigationTests()
  registerWorkspaceSidebarPinnedSessionTests()
  registerWorkspaceSidebarSessionActionsTests()
})
