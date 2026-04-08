import { clamp } from 'effect/Number'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { measureElement as measureVirtualElement, useVirtualizer } from '@tanstack/react-virtual'

import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from '../../chat-scroll'
import { estimateTimelineMessageHeight } from '../timelineHeight'
import {
  ALWAYS_UNVIRTUALIZED_TAIL_ROWS,
  estimateTimelineProposedPlanHeight,
  getFirstUnvirtualizedRowIndex,
  type TimelineRow,
} from './MessagesTimeline.model'

export function useTimelineRootWidth({
  timelineRootRef,
  hasMessages,
  isWorking,
}: {
  timelineRootRef: RefObject<HTMLDivElement | null>
  hasMessages: boolean
  isWorking: boolean
}) {
  const [timelineWidthPx, setTimelineWidthPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    const timelineRoot = timelineRootRef.current
    if (!timelineRoot) return

    const updateWidth = (nextWidth: number) => {
      setTimelineWidthPx(previousWidth => {
        if (previousWidth !== null && Math.abs(previousWidth - nextWidth) < 0.5) {
          return previousWidth
        }
        return nextWidth
      })
    }

    updateWidth(timelineRoot.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      updateWidth(timelineRoot.getBoundingClientRect().width)
    })
    observer.observe(timelineRoot)
    return () => {
      observer.disconnect()
    }
  }, [hasMessages, isWorking, timelineRootRef])

  return timelineWidthPx
}

export function useTimelineVirtualizerState({
  rows,
  activeTurnInProgress,
  activeTurnStartedAt,
  scrollContainer,
  timelineWidthPx,
}: {
  rows: TimelineRow[]
  activeTurnInProgress: boolean
  activeTurnStartedAt: string | null
  scrollContainer: HTMLDivElement | null
  timelineWidthPx: number | null
}) {
  const firstUnvirtualizedRowIndex = useMemo(
    () =>
      getFirstUnvirtualizedRowIndex({
        rows,
        activeTurnInProgress,
        activeTurnStartedAt,
        alwaysUnvirtualizedTailRows: ALWAYS_UNVIRTUALIZED_TAIL_ROWS,
      }),
    [activeTurnInProgress, activeTurnStartedAt, rows]
  )

  return useTimelineVirtualizerCore({
    rows,
    scrollContainer,
    timelineWidthPx,
    firstUnvirtualizedRowIndex,
  })
}

function useTimelineVirtualizerCore({
  rows,
  scrollContainer,
  timelineWidthPx,
  firstUnvirtualizedRowIndex,
}: {
  rows: TimelineRow[]
  scrollContainer: HTMLDivElement | null
  timelineWidthPx: number | null
  firstUnvirtualizedRowIndex: number
}) {
  const virtualizedRowCount = clamp(firstUnvirtualizedRowIndex, {
    minimum: 0,
    maximum: rows.length,
  })

  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollContainer,
    getItemKey: (index: number) => rows[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = rows[index]
      if (!row) return 96
      if (row.kind === 'work') return 112
      if (row.kind === 'proposed-plan') return estimateTimelineProposedPlanHeight(row.proposedPlan)
      if (row.kind === 'working') return 40
      return estimateTimelineMessageHeight(row.message, { timelineWidthPx })
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  })

  useEffect(() => {
    if (timelineWidthPx === null) return
    rowVirtualizer.measure()
  }, [rowVirtualizer, timelineWidthPx])

  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0
      const scrollOffset = instance.scrollOffset ?? 0
      const itemIntersectsViewport =
        item.end > scrollOffset && item.start < scrollOffset + viewportHeight
      if (itemIntersectsViewport) {
        return false
      }
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight)
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX
    }
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
    }
  }, [rowVirtualizer])

  const onTimelineImageLoad = useTimelineImageMeasure(rowVirtualizer)

  return {
    virtualizedRowCount,
    rowVirtualizer,
    virtualRows: rowVirtualizer.getVirtualItems(),
    nonVirtualizedRows: rows.slice(virtualizedRowCount),
    onTimelineImageLoad,
  }
}

function useTimelineImageMeasure(rowVirtualizer: { measure: () => void }) {
  const pendingMeasureFrameRef = useRef<number | null>(null)
  const onTimelineImageLoad = useCallback(() => {
    if (pendingMeasureFrameRef.current !== null) return
    pendingMeasureFrameRef.current = window.requestAnimationFrame(() => {
      pendingMeasureFrameRef.current = null
      rowVirtualizer.measure()
    })
  }, [rowVirtualizer])

  useEffect(
    () => () => {
      const frame = pendingMeasureFrameRef.current
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    },
    []
  )

  return onTimelineImageLoad
}
