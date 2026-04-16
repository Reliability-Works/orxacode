import { MessageId, ThreadId } from '@orxa-code/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  }

  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  vi.stubGlobal('window', {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  })
  vi.stubGlobal('document', {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
})

type MessagesTimelineProps = ComponentProps<typeof import('./MessagesTimeline').MessagesTimeline>

function createBaseProps(): Omit<MessagesTimelineProps, 'timelineEntries'> {
  return {
    hasMessages: true,
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    scrollContainer: null,
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    nowIso: '2026-03-17T19:12:30.000Z',
    expandedWorkGroups: {},
    onToggleWorkGroup: () => {},
    onOpenGitSidebar: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    markdownCwd: undefined,
    resolvedTheme: 'light',
    timestampFormat: 'locale',
    workspaceRoot: undefined,
    threadId: ThreadId.makeUnsafe('thread-1'),
  }
}

async function renderMessagesTimeline(
  timelineEntries: MessagesTimelineProps['timelineEntries'],
  overrides: Partial<Omit<MessagesTimelineProps, 'timelineEntries'>> = {}
) {
  const { MessagesTimeline } = await import('./MessagesTimeline')
  return renderToStaticMarkup(
    <MessagesTimeline {...createBaseProps()} {...overrides} timelineEntries={timelineEntries} />
  )
}

describe('MessagesTimeline', () => {
  it('renders inline terminal labels with the composer chip UI', async () => {
    const markup = await renderMessagesTimeline([
      {
        id: 'entry-1',
        kind: 'message',
        createdAt: '2026-03-17T19:12:28.000Z',
        message: {
          id: MessageId.makeUnsafe('message-2'),
          role: 'user',
          text: [
            "yoo what's @terminal-1:1-5 mean",
            '',
            '<terminal_context>',
            '- Terminal 1 lines 1-5:',
            '  1 | julius@mac effect-http-ws-cli % bun i',
            '  2 | bun install v1.3.9 (cf6cdbbb)',
            '</terminal_context>',
          ].join('\n'),
          createdAt: '2026-03-17T19:12:28.000Z',
          streaming: false,
        },
      },
    ])

    expect(markup).toContain('Terminal 1 lines 1-5')
    expect(markup).toContain('lucide-terminal')
    expect(markup).toContain('yoo what&#x27;s ')
  }, 15_000)

  it('renders context compaction entries in the normal work log', async () => {
    const markup = await renderMessagesTimeline(
      [
        {
          id: 'entry-1',
          kind: 'work',
          createdAt: '2026-03-17T19:12:28.000Z',
          entry: {
            id: 'work-1',
            createdAt: '2026-03-17T19:12:28.000Z',
            label: 'Context compacted',
            tone: 'info',
          },
        },
      ],
      { expandedWorkGroups: { 'entry-1': true } }
    )

    expect(markup).toContain('Context compacted')
    expect(markup).toContain('Work log')
  })
})

type WorkTimelineEntry = Extract<MessagesTimelineProps['timelineEntries'][number], { kind: 'work' }>

function buildSingleWorkEntry(
  entry: WorkTimelineEntry['entry']
): MessagesTimelineProps['timelineEntries'] {
  return [
    {
      id: 'entry-1',
      kind: 'work',
      createdAt: '2026-03-17T19:12:28.000Z',
      entry,
    },
  ]
}

describe('MessagesTimeline work groups', () => {
  it('collapses work groups by default and shows a chevron toggle', async () => {
    const markup = await renderMessagesTimeline(
      buildSingleWorkEntry({
        id: 'work-1',
        createdAt: '2026-03-17T19:12:28.000Z',
        label: 'Context compacted',
        tone: 'info',
      })
    )

    expect(markup).toContain('Work log')
    expect(markup).toContain('lucide-chevron-down')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('Context compacted')
  })

  it('renders relative paths in the work entry preview when workspaceRoot is set', async () => {
    const markup = await renderMessagesTimeline(
      buildSingleWorkEntry({
        id: 'work-1',
        createdAt: '2026-03-17T19:12:28.000Z',
        label: 'Edit',
        tone: 'tool',
        itemType: 'file_change',
        changedFiles: ['/Users/cal/repo/src/index.ts'],
      }),
      {
        expandedWorkGroups: { 'entry-1': true },
        workspaceRoot: '/Users/cal/repo',
      }
    )

    expect(markup).toContain('- src/index.ts')
    expect(markup).not.toContain('/Users/cal/repo/src/index.ts')
  })

  it('shows a single changed file in the preview without a badge duplicate', async () => {
    const markup = await renderMessagesTimeline(
      buildSingleWorkEntry({
        id: 'work-1',
        createdAt: '2026-03-17T19:12:28.000Z',
        label: 'Edit',
        detail: 'applied 3 hunks',
        tone: 'tool',
        itemType: 'file_change',
        changedFiles: ['/Users/cal/repo/src/index.ts'],
      }),
      {
        expandedWorkGroups: { 'entry-1': true },
        workspaceRoot: '/Users/cal/repo',
      }
    )

    expect(markup).toContain('- src/index.ts')
    expect(markup).not.toContain('/Users/cal/repo/src/index.ts')
  })
})

describe('MessagesTimeline changed-file splat', () => {
  it('renders one row per changed file when the group is expanded', async () => {
    const markup = await renderMessagesTimeline(
      buildSingleWorkEntry({
        id: 'work-1',
        createdAt: '2026-03-17T19:12:28.000Z',
        label: 'File change',
        tone: 'tool',
        itemType: 'file_change',
        action: 'edit',
        changedFiles: [
          '/Users/cal/repo/codex-test-1.txt',
          '/Users/cal/repo/codex-test-2.txt',
          '/Users/cal/repo/codex-test-3.txt',
        ],
      }),
      {
        expandedWorkGroups: { 'entry-1': true },
        workspaceRoot: '/Users/cal/repo',
      }
    )

    expect(markup).toContain('codex-test-1.txt')
    expect(markup).toContain('codex-test-2.txt')
    expect(markup).toContain('codex-test-3.txt')
    expect(markup).not.toContain('+2 more')
  })
})

describe('MessagesTimeline work group headings', () => {
  it('synthesizes a semantic heading from the work entries in the group', async () => {
    const markup = await renderMessagesTimeline([
      {
        id: 'entry-1',
        kind: 'work',
        createdAt: '2026-03-17T19:12:28.000Z',
        entry: {
          id: 'work-1',
          createdAt: '2026-03-17T19:12:28.000Z',
          label: 'Read',
          tone: 'tool',
          itemType: 'file_change',
          action: 'read',
        },
      },
      {
        id: 'entry-2',
        kind: 'work',
        createdAt: '2026-03-17T19:12:29.000Z',
        entry: {
          id: 'work-2',
          createdAt: '2026-03-17T19:12:29.000Z',
          label: 'Edit',
          tone: 'tool',
          itemType: 'file_change',
          action: 'edit',
        },
      },
      {
        id: 'entry-3',
        kind: 'work',
        createdAt: '2026-03-17T19:12:30.000Z',
        entry: {
          id: 'work-3',
          createdAt: '2026-03-17T19:12:30.000Z',
          label: 'Shell',
          tone: 'tool',
          itemType: 'command_execution',
          action: 'command',
        },
      },
    ])

    expect(markup).toContain('Edited 1 file')
    expect(markup).toContain('Read 1 file')
    expect(markup).toContain('Ran 1 command')
  })
})
