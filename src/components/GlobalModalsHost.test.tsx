import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { SkillEntry } from '@shared/ipc'
import { GlobalModalsHost, type GlobalModalsHostProps } from './GlobalModalsHost'

function createSession(overrides?: Partial<Session>): Session {
  const now = Date.now()
  return {
    id: 'session-1',
    title: 'Session 1',
    slug: 'session-1',
    projectID: 'project-1',
    directory: '/tmp/project',
    version: '1',
    parentID: undefined,
    time: { created: now, updated: now },
    ...overrides,
  }
}

function buildProps(overrides?: Partial<GlobalModalsHostProps>): GlobalModalsHostProps {
  return {
    activeProjectDir: '/tmp/project',
    workspaceDetailDirectory: '/tmp/project',
    permissionMode: 'ask-write',
    dependencyReport: null,
    dependencyModalOpen: false,
    setDependencyModalOpen: vi.fn(),
    onCheckDependencies: vi.fn(),
    permissionRequest: null,
    permissionDecisionInFlight: false,
    replyPermission: vi.fn(),
    questionRequest: null,
    replyQuestion: vi.fn(),
    rejectQuestion: vi.fn(),
    allSessionsModalOpen: false,
    setAllSessionsModalOpen: vi.fn(),
    claudeSessionBrowserOpen: false,
    setClaudeSessionBrowserOpen: vi.fn(),
    claudeBrowserSessions: [],
    claudeBrowserSessionsLoading: false,
    selectedClaudeBrowserWorkspace: '/tmp/project',
    setSelectedClaudeBrowserWorkspace: vi.fn(),
    openClaudeBrowserSession: vi.fn(async () => undefined),
    sessions: [],
    workspaceWorktrees: [],
    workspaceWorktreesLoading: false,
    workspaceCodexThreads: [],
    selectedWorktreeDirectory: '',
    setSelectedWorktreeDirectory: vi.fn(),
    createWorkspaceWorktree: vi.fn(async () => undefined),
    openWorkspaceWorktree: vi.fn(async () => undefined),
    deleteWorkspaceWorktree: vi.fn(async () => undefined),
    launchSessionInWorktree: vi.fn(async () => undefined),
    openWorkspaceCodexThread: vi.fn(async () => undefined),
    getSessionStatusType: () => 'idle',
    activeSessionID: undefined,
    openSession: vi.fn(),
    projects: [],
    branchCreateModalOpen: false,
    setBranchCreateModalOpen: vi.fn(),
    branchCreateName: '',
    setBranchCreateName: vi.fn(),
    branchCreateError: null,
    setBranchCreateError: vi.fn(),
    submitBranchCreate: vi.fn(async () => undefined),
    branchSwitching: false,
    commitModalOpen: false,
    setCommitModalOpen: vi.fn(),
    commitSummary: null,
    commitSummaryLoading: false,
    commitIncludeUnstaged: false,
    setCommitIncludeUnstaged: vi.fn(),
    commitMessageDraft: '',
    setCommitMessageDraft: vi.fn(),
    commitNextStepOptions: [],
    commitNextStep: 'commit',
    setCommitNextStep: vi.fn(),
    commitSubmitting: false,
    commitBaseBranch: '',
    setCommitBaseBranch: vi.fn(),
    commitBaseBranchOptions: [],
    commitBaseBranchLoading: false,
    commitFlowState: null,
    dismissCommitFlowState: vi.fn(),
    submitCommit: vi.fn(async () => undefined),
    addProjectDirectory: vi.fn(async () => undefined),
    skillUseModal: null,
    setSkillUseModal: vi.fn(),
    applySkillToProject: vi.fn(async () => undefined),
    profileModalOpen: false,
    setProfileModalOpen: vi.fn(),
    profiles: [],
    runtime: { status: 'disconnected', managedServer: false },
    onSaveProfile: vi.fn(async () => undefined),
    onDeleteProfile: vi.fn(async () => undefined),
    onAttachProfile: vi.fn(async () => undefined),
    onStartLocalProfile: vi.fn(async () => undefined),
    onStopLocalProfile: vi.fn(async () => undefined),
    ...overrides,
  }
}

// Permission modal removed — now handled by PermissionDock in ComposerPanel.

it('hides permission modal when permission mode is yolo-write', () => {
  render(
    <GlobalModalsHost
      {...buildProps({
        permissionMode: 'yolo-write',
        permissionRequest: {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['echo test'],
          metadata: {},
          always: [],
        },
      })}
    />
  )

  expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument()
  expect(screen.queryByText('Permission Request')).not.toBeInTheDocument()
})

it('shows a yellow attention indicator for permission-blocked sessions', () => {
  const { container } = render(
    <GlobalModalsHost
      {...buildProps({
        allSessionsModalOpen: true,
        sessions: [createSession()],
        getSessionStatusType: () => 'permission',
      })}
    />
  )

  const indicator = container.querySelector('.session-status-indicator.attention')
  expect(indicator).not.toBeNull()
  expect(indicator?.textContent).toBe('!')
})

it('launches provider sessions into the selected worktree from the workspace detail modal', () => {
  const launchSessionInWorktree = vi.fn(async () => undefined)
  render(
    <GlobalModalsHost
      {...buildProps({
        allSessionsModalOpen: true,
        workspaceWorktrees: [
          {
            id: '/tmp/project/.worktrees/feature-a',
            name: 'feature-a',
            directory: '/tmp/project/.worktrees/feature-a',
            repoRoot: '/tmp/project',
            branch: 'feature-a',
            isMain: false,
            locked: false,
            prunable: false,
          },
        ],
        selectedWorktreeDirectory: '/tmp/project/.worktrees/feature-a',
        launchSessionInWorktree,
      })}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'New Claude Chat' }))

  expect(launchSessionInWorktree).toHaveBeenCalledWith(
    '/tmp/project/.worktrees/feature-a',
    'claude-chat'
  )
})

it('opens workspace-detail sessions using their own directory association', () => {
  const openSession = vi.fn()
  render(
    <GlobalModalsHost
      {...buildProps({
        activeProjectDir: '/tmp/project/.worktrees/feature-a',
        workspaceDetailDirectory: '/tmp/project',
        allSessionsModalOpen: true,
        activeSessionID: 'session-worktree',
        sessions: [
          createSession({
            id: 'session-worktree',
            title: 'Feature Session',
            directory: '/tmp/project/.worktrees/feature-a',
          }),
        ],
        openSession,
      })}
    />
  )

  fireEvent.click(screen.getByTitle('Feature Session'))
  expect(openSession).toHaveBeenCalledWith(
    '/tmp/project/.worktrees/feature-a',
    'session-worktree'
  )
})

it('opens workspace Codex threads using their associated directory', () => {
  const openWorkspaceCodexThread = vi.fn(async () => undefined)
  render(
    <GlobalModalsHost
      {...buildProps({
        allSessionsModalOpen: true,
        workspaceCodexThreads: [
          {
            id: 'thread-worktree',
            sessionKey: 'codex::/tmp/project/.worktrees/feature-a::thread-worktree',
            directory: '/tmp/project/.worktrees/feature-a',
            preview: 'Recovered thread',
            modelProvider: 'openai',
            createdAt: Date.now(),
            status: { type: 'completed' },
          },
        ],
        openWorkspaceCodexThread,
      })}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /Recovered thread/i }))
  expect(openWorkspaceCodexThread).toHaveBeenCalledWith(
    '/tmp/project/.worktrees/feature-a',
    'thread-worktree',
    'Recovered thread'
  )
})

it('imports an available Claude provider session into the selected workspace', () => {
  const openClaudeBrowserSession = vi.fn(async () => undefined)
  render(
    <GlobalModalsHost
      {...buildProps({
        claudeSessionBrowserOpen: true,
        claudeBrowserSessions: [
          {
            providerThreadId: 'claude-provider-1',
            title: 'Recovered Claude Session',
            preview: 'Continue the booking flow',
            cwd: '/repo/source',
            lastUpdatedAt: Date.now(),
            isArchived: false,
          },
        ],
        openClaudeBrowserSession,
      })}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /Recovered Claude Session/i }))
  expect(openClaudeBrowserSession).toHaveBeenCalledWith(
    expect.objectContaining({
      providerThreadId: 'claude-provider-1',
    })
  )
})

it('asks whether to use current or new session before preparing a skill prompt', async () => {
  const skill: SkillEntry = {
    id: 'frontend-design',
    name: 'frontend-design',
    description: 'Design beautiful frontend interfaces.',
    path: '/tmp/skills/frontend-design',
  }
  const applySkillToProject = vi.fn(async () => undefined)
  render(
    <GlobalModalsHost
      {...buildProps({
        projects: [{ id: 'project-1', source: 'local', worktree: '/tmp/project', name: 'Project' }],
        skillUseModal: { skill, projectDir: '/tmp/project' },
        applySkillToProject,
      })}
    />
  )

  expect(screen.getByRole('button', { name: 'Add new workspace' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare prompt' }))
  expect(screen.getByText('Add this prepared prompt to:')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Current session' }))
  expect(applySkillToProject).toHaveBeenCalledWith(skill, '/tmp/project', 'current')
})

// Question modals removed — now handled by QuestionDock in ComposerPanel.

it('renders commit stats and base branch selector for PR commits', () => {
  render(
    <GlobalModalsHost
      {...buildProps({
        commitModalOpen: true,
        commitSummaryLoading: false,
        commitSummary: {
          branch: 'feature/alpha',
          filesChanged: 3,
          insertions: 22,
          deletions: 5,
          repoRoot: '/tmp/project',
        },
        commitNextStep: 'commit_and_create_pr',
        commitBaseBranch: 'main',
        commitBaseBranchOptions: ['main', 'staging'],
      })}
    />
  )

  expect(screen.getByText('+22')).toBeInTheDocument()
  expect(screen.getByText('-5')).toBeInTheDocument()
  expect(screen.getByLabelText('Base branch for PR')).toBeInTheDocument()
})

it('shows commit execution progress modal while running', () => {
  render(
    <GlobalModalsHost
      {...buildProps({
        commitFlowState: {
          phase: 'running',
          nextStep: 'commit_and_push',
          message: 'Committing changes and pushing',
        },
      })}
    />
  )

  expect(screen.getByText('Committing changes and pushing')).toBeInTheDocument()
})
