import type { ToolCallStatus } from './ToolCallCard'
import type { ContextToolItem } from './ContextToolGroup'
import type { ExploreRowItem } from './ExploreRow'
import type { TimelineBlock } from '../../lib/message-feed-timeline'

export type UnifiedMessageSection =
  | {
      id: string
      type: 'text'
      content: string
    }
  | {
      id: string
      type: 'file'
      label: string
    }
  | {
      id: string
      type: 'image'
      url: string
      label: string
    }

export type UnifiedTimelineRenderRow =
  | {
      id: string
      kind: 'message'
      role: 'user' | 'assistant'
      label: string
      timestamp?: number
      showHeader?: boolean
      copyText?: string
      copyLabel?: string
      sections: UnifiedMessageSection[]
    }
  | {
      id: string
      kind: 'thinking'
      summary?: string
      content?: string
    }
  | {
      id: string
      kind: 'tool'
      title: string
      expandedTitle?: string
      subtitle?: string
      status: ToolCallStatus
      command?: string
      output?: string
      error?: string
      defaultExpanded?: boolean
    }
  | {
      id: string
      kind: 'diff'
      path: string
      type: string
      diff?: string
      insertions?: number
      deletions?: number
    }
  | {
      id: string
      kind: 'diff-group'
      title: string
      files: Array<{
        id: string
        path: string
        type: string
        diff?: string
        insertions?: number
        deletions?: number
      }>
    }
  | {
      id: string
      kind: 'tool-group'
      title: string
      files: Array<{
        id: string
        path: string
        type: string
        diff?: string
        insertions?: number
        deletions?: number
      }>
      tools?: Array<Extract<UnifiedTimelineRenderRow, { kind: 'tool' }>>
    }
  | {
      id: string
      kind: 'context'
      items: ContextToolItem[]
    }
  | {
      id: string
      kind: 'explore'
      item: ExploreRowItem
    }
  | {
      id: string
      kind: 'timeline'
      blocks: TimelineBlock[]
    }
  | {
      id: string
      kind: 'notice'
      label: string
      detail?: string
      tone?: 'info' | 'error'
      timestamp?: number
    }
  | {
      id: string
      kind: 'status'
      label: string
    }
  | {
      id: string
      kind: 'compaction'
    }
  | {
      id: string
      kind: 'turn-divider'
      timestamp?: number
      durationSeconds?: number
    }
  | {
      id: string
      kind: 'plan-card'
      content: string
      timestamp?: number
    }

function estimateMessageSectionHeight(section: UnifiedMessageSection) {
  if (section.type === 'text') {
    return 28 + Math.min(420, Math.ceil(section.content.length / 72) * 20)
  }
  return 32
}

function estimateToolHeight(tool: Extract<UnifiedTimelineRenderRow, { kind: 'tool' }>) {
  return 80 + Math.min(520, Math.ceil(((tool.output ?? tool.error)?.length ?? 0) / 120) * 18)
}

function estimateRowGroupHeight(
  rows: Array<{ diff?: string; output?: string; error?: string }> | undefined,
  baseHeight: number
) {
  return (
    baseHeight +
    (rows ?? []).reduce(
      (total, row) => total + (row.diff ? 68 : 44) + Math.min(520, Math.ceil(((row.output ?? row.error)?.length ?? 0) / 120) * 18),
      0
    )
  )
}

type RowHeightEstimator = (row: UnifiedTimelineRenderRow) => number

type MessageRow = Extract<UnifiedTimelineRenderRow, { kind: 'message' }>
type ThinkingRow = Extract<UnifiedTimelineRenderRow, { kind: 'thinking' }>
type ToolRow = Extract<UnifiedTimelineRenderRow, { kind: 'tool' }>
type DiffRow = Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>
type DiffGroupRow = Extract<UnifiedTimelineRenderRow, { kind: 'diff-group' }>
type ToolGroupRow = Extract<UnifiedTimelineRenderRow, { kind: 'tool-group' }>
type ContextRow = Extract<UnifiedTimelineRenderRow, { kind: 'context' }>
type ExploreTimelineRow = Extract<UnifiedTimelineRenderRow, { kind: 'explore' }>
type TimelineRow = Extract<UnifiedTimelineRenderRow, { kind: 'timeline' }>
type NoticeRow = Extract<UnifiedTimelineRenderRow, { kind: 'notice' }>
type PlanCardRow = Extract<UnifiedTimelineRenderRow, { kind: 'plan-card' }>

const estimateMessageRowHeight: RowHeightEstimator = row => {
  const messageRow = row as MessageRow
  let estimate = messageRow.showHeader === false ? 28 : 52
  for (const section of messageRow.sections) {
    estimate += estimateMessageSectionHeight(section)
  }
  return Math.min(estimate, 1400)
}

const estimateThinkingRowHeight: RowHeightEstimator = row =>
  ((row as ThinkingRow).content?.trim() ? 92 : 36)

const estimateDiffRowHeight: RowHeightEstimator = row => ((row as DiffRow).diff ? 68 : 44)

const estimateDiffGroupRowHeight: RowHeightEstimator = row =>
  34 +
  (row as DiffGroupRow).files.reduce((total, file) => total + (file.diff ? 68 : 44), 0)

const estimateToolGroupRowHeight: RowHeightEstimator = row =>
  34 +
  (row as ToolGroupRow).files.reduce((total, file) => total + (file.diff ? 68 : 44), 0) +
  estimateRowGroupHeight((row as ToolGroupRow).tools, 0)

const estimateContextRowHeight: RowHeightEstimator = row =>
  ((row as ContextRow).items.length > 1 ? 72 : 52)

const estimateExploreRowHeight: RowHeightEstimator = row =>
  44 + (row as ExploreTimelineRow).item.entries.length * 24

const estimateTimelineRowHeight: RowHeightEstimator = row =>
  Math.min(120 + (row as TimelineRow).blocks.length * 36, 920)

const estimateNoticeRowHeight: RowHeightEstimator = row => ((row as NoticeRow).detail ? 112 : 84)

const estimatePlanCardRowHeight: RowHeightEstimator = row =>
  60 + Math.min(400, Math.ceil((row as PlanCardRow).content.length / 72) * 20)

const ROW_HEIGHT_ESTIMATORS: Record<UnifiedTimelineRenderRow['kind'], RowHeightEstimator> = {
  message: estimateMessageRowHeight,
  thinking: estimateThinkingRowHeight,
  tool: row => estimateToolHeight(row as ToolRow),
  diff: estimateDiffRowHeight,
  'diff-group': estimateDiffGroupRowHeight,
  'tool-group': estimateToolGroupRowHeight,
  context: estimateContextRowHeight,
  explore: estimateExploreRowHeight,
  timeline: estimateTimelineRowHeight,
  notice: estimateNoticeRowHeight,
  status: () => 30,
  compaction: () => 42,
  'turn-divider': () => 32,
  'plan-card': estimatePlanCardRowHeight,
}

export function estimateUnifiedTimelineRowHeight(row: UnifiedTimelineRenderRow) {
  return ROW_HEIGHT_ESTIMATORS[row.kind](row)
}
