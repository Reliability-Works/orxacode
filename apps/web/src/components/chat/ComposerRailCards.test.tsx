// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerSubagentRailCard } from './ComposerSubagentRailCard'
import { ComposerTaskListRailCard } from './ComposerTaskListRailCard'

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
