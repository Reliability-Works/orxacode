// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerQueuedMessagesRailCard } from './ComposerQueuedMessagesTray'
import { ComposerSubagentRailCard } from './ComposerSubagentRailCard'
import { ComposerTaskListRailCard } from './ComposerTaskListRailCard'
import type { QueuedComposerMessage } from './queuedComposerMessages'
import { shouldQueueComposerSendForPhase } from './useChatViewController.plansend'

const useChatViewCtxMock = vi.fn()
const useStoreMock = vi.fn()
const deriveRailSubagentItemsMock = vi.fn()
const hasLiveSubagentMock = vi.fn()

vi.mock('./ChatViewContext', () => ({
  useChatViewCtx: () => useChatViewCtxMock(),
}))

vi.mock('../../store', () => ({
  useStore: (selector: (state: { threads: unknown[] }) => unknown) => useStoreMock(selector),
}))

vi.mock('./ComposerSubagentRailCard.helpers', () => ({
  deriveRailSubagentItems: (...args: unknown[]) => deriveRailSubagentItemsMock(...args),
  hasLiveSubagent: (...args: unknown[]) => hasLiveSubagentMock(...args),
}))

vi.mock('../ChatMarkdown', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}))

describe('composer rail cards', () => {
  beforeEach(() => {
    useChatViewCtxMock.mockReset()
    useStoreMock.mockReset()
    deriveRailSubagentItemsMock.mockReset()
    hasLiveSubagentMock.mockReset()
  })

  it('renders the task list rail collapsed by default on mount and remount', () => {
    useChatViewCtxMock.mockReturnValue({
      p: {
        activePlan: {
          steps: [{ status: 'inProgress', step: 'Inspect the drawer defaults' }],
        },
        sidebarProposedPlan: null,
      },
      gitCwd: '/tmp/project',
    })

    const firstRender = render(<ComposerTaskListRailCard />)

    expect(screen.getByText('Task list')).toBeDefined()
    expect(screen.getByText('0/1 complete')).toBeDefined()
    expect(screen.queryByText('Inspect the drawer defaults')).toBeNull()

    firstRender.unmount()
    render(<ComposerTaskListRailCard />)

    expect(screen.queryByText('Inspect the drawer defaults')).toBeNull()
  })

  it('renders the subagent rail collapsed by default on mount and remount', () => {
    useChatViewCtxMock.mockReturnValue({
      td: {
        activeThread: {
          id: 'thread-parent',
        },
      },
    })
    useStoreMock.mockImplementation((selector: (state: { threads: unknown[] }) => unknown) =>
      selector({ threads: [] })
    )
    deriveRailSubagentItemsMock.mockReturnValue([
      {
        threadId: 'thread-child',
        parentThreadId: 'thread-parent',
        modelLabel: 'Explore',
        title: 'Explore subagent',
        prompt: 'Inspect provider routing',
        status: 'running',
      },
    ])
    hasLiveSubagentMock.mockReturnValue(true)

    const firstRender = render(<ComposerSubagentRailCard />)

    expect(screen.getByText('Subagents')).toBeDefined()
    expect(screen.getByText('1 active')).toBeDefined()
    expect(screen.queryByText(/Inspect provider routing/)).toBeNull()

    firstRender.unmount()
    render(<ComposerSubagentRailCard />)

    expect(screen.queryByText(/Inspect provider routing/)).toBeNull()
  })
})

describe('composer queued message rail card', () => {
  beforeEach(() => {
    useChatViewCtxMock.mockReset()
  })

  it('sends a queued composer message directly from the tray instead of interrupting', () => {
    const queuedMessage: QueuedComposerMessage = {
      id: 'queued:one',
      createdAt: '2026-04-27T10:00:00.000Z',
      prompt: 'restore pls',
      trimmed: 'restore pls',
      images: [],
      terminalContexts: [],
      selectedProvider: 'claudeAgent',
      selectedModel: 'claude-sonnet-4-6',
      selectedModelSelection: {
        provider: 'claudeAgent',
        model: 'claude-sonnet-4-6',
      },
      selectedPromptEffort: null,
      runtimeMode: 'full-access',
      interactionMode: 'default',
    }
    const sendQueuedComposerMessageNow = vi.fn()
    const onInterrupt = vi.fn()

    useChatViewCtxMock.mockReturnValue({
      ls: {
        queuedComposerMessages: [queuedMessage],
      },
      restoreQueuedComposerMessage: vi.fn(),
      removeQueuedComposerMessage: vi.fn(),
      sendQueuedComposerMessageNow,
      onInterrupt,
    })

    render(<ComposerQueuedMessagesRailCard />)
    fireEvent.click(screen.getByTestId('composer-queued-message-send-now'))

    expect(sendQueuedComposerMessageNow).toHaveBeenCalledWith(queuedMessage)
    expect(onInterrupt).not.toHaveBeenCalled()
  })
})

describe('composer send gating', () => {
  it('does not queue a ready session even if latest turn metadata is stale', () => {
    expect(shouldQueueComposerSendForPhase('ready')).toBe(false)
  })

  it('queues only while the live turn phase is running', () => {
    expect(shouldQueueComposerSendForPhase('running')).toBe(true)
  })
})
