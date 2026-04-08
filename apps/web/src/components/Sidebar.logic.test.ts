import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createThreadJumpHintVisibilityController,
  getVisibleSidebarThreadIds,
  resolveAdjacentThreadId,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  orderItemsByPreferredIds,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  shouldClearThreadSelectionOnMouseDown,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from './Sidebar.logic'
import { OrchestrationLatestTurn, ProjectId, ThreadId } from '@orxa-code/contracts'

function makeLatestTurn(overrides?: {
  completedAt?: string | null
  startedAt?: string | null
}): OrchestrationLatestTurn {
  return {
    turnId: 'turn-1' as never,
    state: 'completed',
    assistantMessageId: null,
    requestedAt: '2026-03-09T10:00:00.000Z',
    startedAt: overrides?.startedAt ?? '2026-03-09T10:00:00.000Z',
    completedAt: overrides?.completedAt ?? '2026-03-09T10:05:00.000Z',
  }
}

describe('hasUnseenCompletion', () => {
  it('returns true when a thread completed after its last visit', () => {
    expect(
      hasUnseenCompletion({
        interactionMode: 'default',
        latestTurn: makeLatestTurn(),
        lastVisitedAt: '2026-03-09T10:04:00.000Z',
        proposedPlans: [],
        session: null,
      })
    ).toBe(true)
  })
})

describe('createThreadJumpHintVisibilityController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delays showing jump hints until the configured delay elapses', () => {
    const visibilityChanges: boolean[] = []
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: visible => {
        visibilityChanges.push(visible)
      },
    })

    controller.sync(true)
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1)

    expect(visibilityChanges).toEqual([])

    vi.advanceTimersByTime(1)

    expect(visibilityChanges).toEqual([true])
  })

  it('hides immediately when the modifiers are released', () => {
    const visibilityChanges: boolean[] = []
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: visible => {
        visibilityChanges.push(visible)
      },
    })

    controller.sync(true)
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS)
    controller.sync(false)

    expect(visibilityChanges).toEqual([true, false])
  })

  it('cancels a pending reveal when the modifier is released early', () => {
    const visibilityChanges: boolean[] = []
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: visible => {
        visibilityChanges.push(visible)
      },
    })

    controller.sync(true)
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2))
    controller.sync(false)
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS)

    expect(visibilityChanges).toEqual([])
  })
})

describe('shouldClearThreadSelectionOnMouseDown', () => {
  it('preserves selection for thread items', () => {
    const child = {
      closest: (selector: string) =>
        selector.includes('[data-thread-item]') ? ({} as Element) : null,
    } as unknown as HTMLElement

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false)
  })

  it('preserves selection for thread list toggle controls', () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes('[data-thread-selection-safe]') ? ({} as Element) : null,
    } as unknown as HTMLElement

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false)
  })

  it('clears selection for unrelated sidebar clicks', () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true)
  })
})

describe('resolveSidebarNewThreadEnvMode', () => {
  it('uses the app default when the caller does not request a specific mode', () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: 'worktree',
      })
    ).toBe('worktree')
  })

  it('preserves an explicit requested mode over the app default', () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: 'local',
        defaultEnvMode: 'worktree',
      })
    ).toBe('local')
  })
})

describe('orderItemsByPreferredIds', () => {
  it('keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items', () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.makeUnsafe('project-1'), name: 'One' },
        { id: ProjectId.makeUnsafe('project-2'), name: 'Two' },
        { id: ProjectId.makeUnsafe('project-3'), name: 'Three' },
      ],
      preferredIds: [
        ProjectId.makeUnsafe('project-3'),
        ProjectId.makeUnsafe('project-missing'),
        ProjectId.makeUnsafe('project-1'),
      ],
      getId: project => project.id,
    })

    expect(ordered.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-3'),
      ProjectId.makeUnsafe('project-1'),
      ProjectId.makeUnsafe('project-2'),
    ])
  })

  it('does not duplicate items when preferred ids repeat', () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.makeUnsafe('project-1'), name: 'One' },
        { id: ProjectId.makeUnsafe('project-2'), name: 'Two' },
      ],
      preferredIds: [
        ProjectId.makeUnsafe('project-2'),
        ProjectId.makeUnsafe('project-1'),
        ProjectId.makeUnsafe('project-2'),
      ],
      getId: project => project.id,
    })

    expect(ordered.map(project => project.id)).toEqual([
      ProjectId.makeUnsafe('project-2'),
      ProjectId.makeUnsafe('project-1'),
    ])
  })
})

describe('resolveAdjacentThreadId', () => {
  it('resolves adjacent thread ids in ordered sidebar traversal', () => {
    const threads = [
      ThreadId.makeUnsafe('thread-1'),
      ThreadId.makeUnsafe('thread-2'),
      ThreadId.makeUnsafe('thread-3'),
    ]

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: 'previous',
      })
    ).toBe(threads[0])
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: 'next',
      })
    ).toBe(threads[2])
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: 'next',
      })
    ).toBe(threads[0])
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: 'previous',
      })
    ).toBe(threads[2])
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: 'previous',
      })
    ).toBeNull()
  })
})

describe('getVisibleSidebarThreadIds', () => {
  it('returns only the rendered visible thread order across projects', () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          renderedThreads: [
            { id: ThreadId.makeUnsafe('thread-12') },
            { id: ThreadId.makeUnsafe('thread-11') },
            { id: ThreadId.makeUnsafe('thread-10') },
          ],
        },
        {
          renderedThreads: [
            { id: ThreadId.makeUnsafe('thread-8') },
            { id: ThreadId.makeUnsafe('thread-6') },
          ],
        },
      ])
    ).toEqual([
      ThreadId.makeUnsafe('thread-12'),
      ThreadId.makeUnsafe('thread-11'),
      ThreadId.makeUnsafe('thread-10'),
      ThreadId.makeUnsafe('thread-8'),
      ThreadId.makeUnsafe('thread-6'),
    ])
  })

  it('skips threads from collapsed projects whose thread panels are not shown', () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          shouldShowThreadPanel: false,
          renderedThreads: [
            { id: ThreadId.makeUnsafe('thread-hidden-2') },
            { id: ThreadId.makeUnsafe('thread-hidden-1') },
          ],
        },
        {
          shouldShowThreadPanel: true,
          renderedThreads: [
            { id: ThreadId.makeUnsafe('thread-12') },
            { id: ThreadId.makeUnsafe('thread-11') },
          ],
        },
      ])
    ).toEqual([ThreadId.makeUnsafe('thread-12'), ThreadId.makeUnsafe('thread-11')])
  })
})

describe('isContextMenuPointerDown', () => {
  it('treats secondary-button presses as context menu gestures on all platforms', () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      })
    ).toBe(true)
  })

  it('treats ctrl+primary-click as a context menu gesture on macOS', () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      })
    ).toBe(true)
  })

  it('does not treat ctrl+primary-click as a context menu gesture off macOS', () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      })
    ).toBe(false)
  })
})

describe('resolveThreadRowClassName', () => {
  it('uses the darker selected palette when a thread is both selected and active', () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true })
    expect(className).toContain('bg-primary/22')
    expect(className).toContain('hover:bg-primary/26')
    expect(className).toContain('dark:bg-primary/30')
    expect(className).not.toContain('bg-accent/85')
  })

  it('uses selected hover colors for selected threads', () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true })
    expect(className).toContain('bg-primary/15')
    expect(className).toContain('hover:bg-primary/19')
    expect(className).toContain('dark:bg-primary/22')
    expect(className).not.toContain('hover:bg-accent')
  })

  it('keeps the accent palette for active-only threads', () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false })
    expect(className).toContain('bg-accent/85')
    expect(className).toContain('hover:bg-accent')
  })
})

describe('resolveProjectStatusIndicator', () => {
  it('returns null when no threads have a notable status', () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull()
  })

  it('surfaces the highest-priority actionable state across project threads', () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: 'Completed',
          colorClass: 'text-emerald-600',
          dotClass: 'bg-emerald-500',
          pulse: false,
        },
        {
          label: 'Pending Approval',
          colorClass: 'text-amber-600',
          dotClass: 'bg-amber-500',
          pulse: false,
        },
        {
          label: 'Working',
          colorClass: 'text-sky-600',
          dotClass: 'bg-sky-500',
          pulse: true,
        },
      ])
    ).toMatchObject({ label: 'Pending Approval', dotClass: 'bg-amber-500' })
  })

  it('prefers plan-ready over completed when no stronger action is needed', () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: 'Completed',
          colorClass: 'text-emerald-600',
          dotClass: 'bg-emerald-500',
          pulse: false,
        },
        {
          label: 'Plan Ready',
          colorClass: 'text-violet-600',
          dotClass: 'bg-violet-500',
          pulse: false,
        },
      ])
    ).toMatchObject({ label: 'Plan Ready', dotClass: 'bg-violet-500' })
  })
})
