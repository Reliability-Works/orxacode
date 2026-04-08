import { MessageId } from '@orxa-code/contracts'
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
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    markdownCwd: undefined,
    resolvedTheme: 'light',
    timestampFormat: 'locale',
    workspaceRoot: undefined,
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
  })

  it('renders context compaction entries in the normal work log', async () => {
    const markup = await renderMessagesTimeline([
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
    ])

    expect(markup).toContain('Context compacted')
    expect(markup).toContain('Work log')
  })
})
