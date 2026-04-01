import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeChatPane } from './ClaudeChatPane'
import type { ImageSelection } from '@shared/ipc'
import type { ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'

const startTurnMock = vi.fn()
const archiveProviderSessionMock = vi.fn()
const loadSubagentMessagesMock = vi.fn(async () => [])
const onTitleChangeMock = vi.fn()
const approveActionMock = vi.fn(async () => undefined)
const pickImageMock = vi.fn<() => Promise<ImageSelection | undefined>>(async () => undefined)
let mockSubagents: ClaudeChatSubagentState[] = []
let isStreamingMock = false
let connectionStatusMock: 'disconnected' | 'connecting' | 'connected' | 'error' = 'connected'
let pendingApprovalMock: {
  id: string
  reason: string
  command?: string
} | null = null

vi.mock('../hooks/useClaudeChatSession', () => ({
  useClaudeChatSession: () => ({
    messages: [],
    pendingApproval: pendingApprovalMock,
    pendingUserInput: null,
    isStreaming: isStreamingMock,
    connectionStatus: connectionStatusMock,
    subagents: mockSubagents,
    modelOptions: [
      {
        key: 'claude-chat/claude-sonnet-4-6',
        providerID: 'claude-chat',
        modelID: 'claude-sonnet-4-6',
        providerName: 'Claude',
        modelName: 'Claude Sonnet 4.6',
        variants: [],
      },
    ],
    startTurn: startTurnMock,
    interruptTurn: vi.fn(),
    approveAction: approveActionMock,
    respondToUserInput: vi.fn(),
    archiveProviderSession: archiveProviderSessionMock,
    loadSubagentMessages: loadSubagentMessagesMock,
  }),
}))

vi.mock('./chat/VirtualizedTimeline', () => ({
  VirtualizedTimeline: ({ emptyState }: { emptyState: React.ReactNode }) => <div>{emptyState}</div>,
}))

vi.mock('./chat/UnifiedTimelineRow', () => ({
  UnifiedTimelineRowView: () => null,
}))

function renderClaudeChatPane(permissionMode: 'ask-write' | 'yolo-write' = 'ask-write') {
  return render(
    <ClaudeChatPane
      directory="/tmp/project"
      sessionStorageKey="session-1"
      onTitleChange={onTitleChangeMock}
      permissionMode={permissionMode}
      onPermissionModeChange={vi.fn()}
      branchMenuOpen={false}
      setBranchMenuOpen={vi.fn()}
      branchControlWidthCh={14}
      branchLoading={false}
      branchSwitching={false}
      hasActiveProject
      branchCurrent="main"
      branchDisplayValue="main"
      branchSearchInputRef={{ current: null }}
      branchQuery=""
      setBranchQuery={vi.fn()}
      branchActionError={null}
      clearBranchActionError={vi.fn()}
      checkoutBranch={vi.fn()}
      filteredBranches={['main']}
      openBranchCreateModal={vi.fn()}
      sessionGuardrailPreferences={{
        enabled: true,
        tokenBudget: 120000,
        runtimeBudgetMinutes: 45,
      }}
      onOpenSettings={vi.fn()}
    />
  )
}

function registerClaudePlanModeTests() {
  it('uses /plan to toggle Claude plan mode without showing the composer toggle', () => {
    renderClaudeChatPane()

    expect(screen.queryByRole('button', { name: 'Enable plan mode' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Send to Claude...'), {
      target: { value: '/plan Plan the refactor' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(startTurnMock).toHaveBeenCalledWith(
      'Plan the refactor',
      expect.objectContaining({
        permissionMode: 'plan',
      })
    )
    expect(onTitleChangeMock).toHaveBeenCalledWith('Plan the refactor')
  })
}

function registerClaudeBackgroundArchiveTests() {
  it('archives Claude background agents from the existing dock and hides them locally', async () => {
    mockSubagents = [
      {
        id: 'task-1',
        name: 'Scout',
        role: 'explorer',
        status: 'thinking',
        statusText: 'is running',
        taskText: 'Explore the repo',
        sessionID: 'child-session-1',
      },
    ]

    renderClaudeChatPane()

    fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive Scout' }))

    expect(archiveProviderSessionMock).toHaveBeenCalledWith('child-session-1')
    await waitFor(() => {
      expect(screen.queryByText('Scout')).not.toBeInTheDocument()
    })
  })
}

function registerClaudeBackgroundPollingTests() {
  it('polls the selected Claude subagent transcript while the detail modal is open', async () => {
    vi.useFakeTimers()
    mockSubagents = [
      {
        id: 'task-1',
        name: 'Scout',
        role: 'explorer',
        status: 'thinking',
        statusText: 'is running',
        taskText: 'Explore the repo',
        sessionID: 'child-session-1',
      },
    ]
    loadSubagentMessagesMock.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'First pass',
        timestamp: 1,
        sessionId: 'child-session-1',
      },
    ] as never)

    renderClaudeChatPane()

    fireEvent.click(screen.getByRole('button', { name: 'Expand background agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Scout' }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(loadSubagentMessagesMock).toHaveBeenCalledWith('child-session-1')

    await act(async () => {
      vi.advanceTimersByTime(1300)
      await Promise.resolve()
    })

    expect(loadSubagentMessagesMock.mock.calls.length).toBeGreaterThanOrEqual(2)

    vi.useRealTimers()
  })
}

function registerClaudeAttachmentTests() {
  it('passes attached images through to Claude turns', async () => {
    pickImageMock.mockResolvedValue({
      path: '/tmp/test.png',
      url: 'data:image/png;base64,QQ==',
      filename: 'test.png',
      mime: 'image/png',
    })

    renderClaudeChatPane()

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    await waitFor(() => expect(screen.getByText('test.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))

    await waitFor(() => {
      expect(startTurnMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: 'test.png',
              mime: 'image/png',
            }),
          ],
          displayPrompt: '[image]',
        })
      )
    })
  })
}

function registerClaudePermissionTests() {
  it('auto-approves Claude permissions in yolo mode and hides the permission dock', async () => {
    pendingApprovalMock = {
      id: 'approval-1',
      reason: 'WebFetch: https://example.com',
      command: 'curl https://example.com',
    }

    renderClaudeChatPane('yolo-write')

    await waitFor(() => {
      expect(approveActionMock).toHaveBeenCalledWith('approval-1', 'acceptForSession')
    })
    expect(screen.queryByText('WebFetch: https://example.com')).not.toBeInTheDocument()
  })
}

function registerClaudeComposerChromeTests() {
  it('does not render a separate commands browser control under the composer', () => {
    renderClaudeChatPane()

    expect(
      screen.queryByRole('button', { name: 'Open Claude native commands' })
    ).not.toBeInTheDocument()
  })
}

function registerClaudeSlashAutocompleteTests() {
  it('shows native Claude commands in slash autocomplete alongside skills', async () => {
    vi.mocked(window.orxa.app.listSkillsFromDir).mockResolvedValue([
      {
        id: 'frontend-design',
        name: 'Frontend Design',
        description: 'Create polished interfaces.',
        path: '/Users/callumspencer/.claude/skills/frontend-design',
      },
    ])

    renderClaudeChatPane()

    fireEvent.change(screen.getByPlaceholderText('Send to Claude...'), {
      target: { value: '/mo' },
    })
    expect(screen.getByText('/model')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Send to Claude...'), {
      target: { value: '/front' },
    })

    await waitFor(() => {
      expect(screen.getByText('/frontend-design')).toBeInTheDocument()
    })
  })
}

describe('ClaudeChatPane', () => {
  beforeEach(() => {
    startTurnMock.mockReset()
    archiveProviderSessionMock.mockReset()
    loadSubagentMessagesMock.mockReset()
    loadSubagentMessagesMock.mockResolvedValue([])
    onTitleChangeMock.mockReset()
    approveActionMock.mockReset()
    pickImageMock.mockReset()
    pickImageMock.mockResolvedValue(undefined)
    mockSubagents = []
    isStreamingMock = false
    connectionStatusMock = 'connected'
    pendingApprovalMock = null
    window.orxa = {
      app: {
        listSkillsFromDir: vi.fn(async () => []),
      },
      opencode: {
        pickImage: pickImageMock,
        listFiles: vi.fn(async () => []),
      },
    } as unknown as typeof window.orxa
  })

  registerClaudePlanModeTests()
  registerClaudeBackgroundArchiveTests()
  registerClaudeBackgroundPollingTests()
  registerClaudeAttachmentTests()
  registerClaudePermissionTests()
  registerClaudeComposerChromeTests()
  registerClaudeSlashAutocompleteTests()
})
