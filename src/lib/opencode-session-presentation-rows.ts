import type { Part } from '@opencode-ai/sdk/v2/client'
import type { SessionMessageBundle } from '@shared/ipc'
import type {
  UnifiedMessageSection,
  UnifiedTimelineRenderRow,
} from '../components/chat/unified-timeline-model'
import { extractVisibleText } from './message-feed-visibility'
import { getRoleLabel } from './opencode-session-presentation-utils'
import { renderToolParts } from './opencode-session-presentation-tooling'

export function summarizeReasoningPart(part: Part & { type: 'reasoning' }) {
  const record = part as unknown as Record<string, unknown>
  const content =
    typeof record.text === 'string'
      ? record.text
      : typeof record.content === 'string'
        ? record.content
        : ''
  const summary = typeof record.summary === 'string' ? record.summary : ''
  return {
    id: `reasoning:${part.id}`,
    kind: 'thinking' as const,
    summary:
      summary || (content ? content.slice(0, 80) + (content.length > 80 ? '...' : '') : '...'),
    content,
  }
}

function buildMessageSections(bundle: SessionMessageBundle, visibleParts: Part[]) {
  return visibleParts.reduce<UnifiedMessageSection[]>((sections, part) => {
    if (part.type === 'text') {
      sections.push({ id: `${bundle.info.id}:${part.id}:text`, type: 'text', content: part.text })
      return sections
    }
    if (part.type === 'file') {
      const isImage = part.mime?.startsWith('image/') ?? false
      if (isImage && part.url) {
        sections.push({
          id: `${bundle.info.id}:${part.id}:image`,
          type: 'image',
          url: part.url,
          label: part.filename ?? 'image',
        })
      } else {
        sections.push({
          id: `${bundle.info.id}:${part.id}:file`,
          type: 'file',
          label: part.filename ?? part.url,
        })
      }
    }
    return sections
  }, [])
}

export function buildMessageRows(
  bundle: SessionMessageBundle,
  visibleParts: Part[],
  toolParts: Part[],
  changedFiles: Array<Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>>,
  timelineBlocks: ReturnType<typeof import('./message-feed-timeline').buildTimelineBlocks>,
  assistantLabel: string,
  showHeader: boolean,
  workspaceDirectory?: string | null
): UnifiedTimelineRenderRow[] {
  const rows: UnifiedTimelineRenderRow[] = []
  const messageSections = buildMessageSections(bundle, visibleParts)

  if (messageSections.length > 0) {
    rows.push({
      id: `${bundle.info.id}:message`,
      kind: 'message',
      role: bundle.info.role === 'user' ? 'user' : 'assistant',
      label: getRoleLabel(bundle.info.role, assistantLabel),
      timestamp: bundle.info.time.created,
      showHeader,
      copyText: bundle.info.role === 'user' ? extractVisibleText(visibleParts) : undefined,
      copyLabel: bundle.info.role === 'user' ? 'Copy message' : undefined,
      sections: messageSections,
    })
  }

  for (const part of visibleParts) {
    if (part.type === 'reasoning') {
      rows.push(summarizeReasoningPart(part))
    }
  }

  rows.push(...renderToolParts(toolParts, workspaceDirectory))
  rows.push(...changedFiles)

  if (timelineBlocks.length > 0) {
    rows.push({
      id: `${bundle.info.id}:timeline`,
      kind: 'timeline',
      blocks: timelineBlocks,
    })
  }

  return rows
}

function isAssistantContentRow(row: UnifiedTimelineRenderRow) {
  return (
    (row.kind === 'message' && row.role === 'assistant') ||
    row.kind === 'tool' ||
    row.kind === 'diff' ||
    row.kind === 'diff-group' ||
    row.kind === 'tool-group' ||
    row.kind === 'explore' ||
    row.kind === 'thinking'
  )
}

export function injectTurnDividers(
  rows: UnifiedTimelineRenderRow[],
  messages: SessionMessageBundle[]
): UnifiedTimelineRenderRow[] {
  if (rows.length === 0) {
    return rows
  }

  const messageTimestamps = new Map<string, { created: number; updated?: number }>()
  for (const msg of messages) {
    const updated =
      'updated' in msg.info.time && typeof msg.info.time.updated === 'number'
        ? msg.info.time.updated
        : undefined
    messageTimestamps.set(msg.info.id, { created: msg.info.time.created, updated })
  }

  const result: UnifiedTimelineRenderRow[] = []
  let prevWasAssistantContent = false
  let lastAssistantTimestamp: number | undefined
  let lastUserTimestamp: number | undefined

  for (const row of rows) {
    const isUserMessage = row.kind === 'message' && row.role === 'user'

    if (isUserMessage && prevWasAssistantContent) {
      const duration =
        lastAssistantTimestamp !== undefined && lastUserTimestamp !== undefined
          ? Math.round((lastAssistantTimestamp - lastUserTimestamp) / 1000)
          : undefined
      result.push({
        id: `turn-divider:${row.id}`,
        kind: 'turn-divider',
        timestamp: lastAssistantTimestamp,
        durationSeconds: duration !== undefined && duration > 0 ? duration : undefined,
      })
    }

    if (isUserMessage) {
      prevWasAssistantContent = false
      lastUserTimestamp = row.timestamp
    } else if (isAssistantContentRow(row)) {
      prevWasAssistantContent = true
      if (row.kind === 'message' && row.timestamp) {
        lastAssistantTimestamp = row.timestamp
      }
    }

    result.push(row)
  }

  return result
}
