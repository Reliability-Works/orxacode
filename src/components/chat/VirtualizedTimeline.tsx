import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  measureElement,
  type VirtualItem,
  type Virtualizer,
  useVirtualizer,
} from '@tanstack/react-virtual'

export type VirtualizedTimelineRow = {
  id: string
}

type VirtualizedTimelineProps<Row extends VirtualizedTimelineRow> = {
  rows: Row[]
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  className?: string
  ariaLabel?: string
  emptyState?: ReactNode
  footer?: ReactNode
  tailCount?: number
  virtualize?: boolean
  estimateSize: (row: Row) => number
  renderRow: (row: Row, virtualRow?: VirtualItem) => ReactNode
  style?: CSSProperties
  /** When this value changes, scroll is instantly snapped to the bottom (session switch). */
  sessionId?: string
}

const DEFAULT_UNVIRTUALIZED_TAIL_ROWS = 8
const VIRTUALIZED_ROW_GAP_PX = 10
const AUTOSCROLL_BOOTSTRAP_IDLE_MS = 160

function useVirtualizedTimelineScrollBehavior({
  rowsLength,
  scrollRef,
  sessionId,
}: {
  rowsLength: number
  scrollRef: RefObject<HTMLDivElement | null>
  sessionId?: string
}) {
  const UNSET = Symbol.for('vt:unset')
  const prevSessionIdRef = useRef<string | symbol>(UNSET)
  const isAtBottomRef = useRef(true)
  const pendingSnapRef = useRef(sessionId != null)
  const skipNextSmoothScrollRef = useRef(false)
  const bootstrapAutoscrollRef = useRef(sessionId != null)
  const bootstrapTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (sessionId != null && prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      const el = scrollRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
        skipNextSmoothScrollRef.current = true
        bootstrapAutoscrollRef.current = true
        pendingSnapRef.current = el.scrollHeight <= el.clientHeight
      } else {
        pendingSnapRef.current = true
      }
      isAtBottomRef.current = true
      if (bootstrapTimerRef.current != null) {
        window.clearTimeout(bootstrapTimerRef.current)
        bootstrapTimerRef.current = null
      }
    }
  }, [scrollRef, sessionId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const track = () => {
      isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
    }
    el.addEventListener('scroll', track, { passive: true })
    return () => el.removeEventListener('scroll', track)
  }, [scrollRef])

  useLayoutEffect(() => {
    if (!pendingSnapRef.current || !isAtBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    skipNextSmoothScrollRef.current = true
    bootstrapAutoscrollRef.current = true
    if (rowsLength > 0 || el.scrollHeight > el.clientHeight) {
      pendingSnapRef.current = false
    }
  }, [rowsLength, scrollRef])

  useEffect(() => {
    if (!bootstrapAutoscrollRef.current) return
    if (bootstrapTimerRef.current != null) {
      window.clearTimeout(bootstrapTimerRef.current)
    }
    bootstrapTimerRef.current = window.setTimeout(() => {
      bootstrapAutoscrollRef.current = false
      bootstrapTimerRef.current = null
    }, AUTOSCROLL_BOOTSTRAP_IDLE_MS)
  }, [rowsLength, sessionId])

  useEffect(
    () => () => {
      if (bootstrapTimerRef.current != null) {
        window.clearTimeout(bootstrapTimerRef.current)
        bootstrapTimerRef.current = null
      }
    },
    []
  )

  useEffect(() => {
    if (!isAtBottomRef.current || pendingSnapRef.current) return
    const el = scrollRef.current
    if (!el) return
    if (bootstrapAutoscrollRef.current) {
      el.scrollTop = el.scrollHeight
      return
    }
    if (skipNextSmoothScrollRef.current) {
      skipNextSmoothScrollRef.current = false
      return
    }
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [rowsLength, scrollRef])
}

function StaticTimelineContent<Row extends VirtualizedTimelineRow>({
  rows,
  scrollRef,
  onScroll,
  className,
  ariaLabel,
  emptyState,
  footer,
  style,
  renderRow,
}: {
  rows: Row[]
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  className: string
  ariaLabel?: string
  emptyState?: ReactNode
  footer?: ReactNode
  style?: CSSProperties
  renderRow: (row: Row) => ReactNode
}) {
  return (
    <div ref={scrollRef} className={className} role={ariaLabel ? 'log' : undefined} aria-label={ariaLabel} onScroll={onScroll} style={style}>
      {rows.length === 0 ? emptyState : null}
      {rows.map(row => (
        <Fragment key={`row:${row.id}`}>{renderRow(row)}</Fragment>
      ))}
      {footer}
    </div>
  )
}

function VirtualizedTimelineContent<Row extends VirtualizedTimelineRow>({
  rows,
  scrollRef,
  onScroll,
  className,
  ariaLabel,
  emptyState,
  footer,
  style,
  renderRow,
  rowVirtualizer,
  virtualizedRowCount,
}: {
  rows: Row[]
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll?: () => void
  className: string
  ariaLabel?: string
  emptyState?: ReactNode
  footer?: ReactNode
  style?: CSSProperties
  renderRow: (row: Row, virtualRow?: VirtualItem) => ReactNode
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  virtualizedRowCount: number
}) {
  const virtualRows = rowVirtualizer.getVirtualItems()
  const nonVirtualizedRows = rows.slice(virtualizedRowCount)

  return (
    <div ref={scrollRef} className={className} role={ariaLabel ? 'log' : undefined} aria-label={ariaLabel} onScroll={onScroll} style={style}>
      {rows.length === 0 ? emptyState : null}
      {virtualizedRowCount > 0 ? (
        <div className="messages-virtual-spacer" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualRows.map(virtualRow => {
            const row = rows[virtualRow.index]
            if (!row) return null
            return (
              <div
                key={`virtual-row:${row.id}`}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="messages-virtual-row"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: virtualRow.index === virtualizedRowCount - 1 ? 0 : `${VIRTUALIZED_ROW_GAP_PX}px`,
                  boxSizing: 'border-box',
                }}
              >
                {renderRow(row, virtualRow)}
              </div>
            )
          })}
        </div>
      ) : null}
      {nonVirtualizedRows.map(row => (
        <Fragment key={`tail-row:${row.id}`}>{renderRow(row)}</Fragment>
      ))}
      {footer}
    </div>
  )
}

export function VirtualizedTimeline<Row extends VirtualizedTimelineRow>({
  rows,
  scrollRef,
  onScroll,
  className = 'messages-scroll',
  ariaLabel,
  emptyState,
  footer,
  tailCount = DEFAULT_UNVIRTUALIZED_TAIL_ROWS,
  virtualize = true,
  estimateSize,
  renderRow,
  style,
  sessionId,
}: VirtualizedTimelineProps<Row>) {
  useVirtualizedTimelineScrollBehavior({ rowsLength: rows.length, scrollRef, sessionId })

  const effectiveVirtualize = virtualize
  const virtualizedRowCount = effectiveVirtualize ? Math.max(rows.length - tailCount, 0) : 0
  const virtualizedRows = rows.slice(0, virtualizedRowCount)
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index: number) => rows[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = rows[index]
      if (!row) {
        return 96
      }
      const gap = index === virtualizedRowCount - 1 ? 0 : VIRTUALIZED_ROW_GAP_PX
      return estimateSize(row) + gap
    },
    measureElement,
    overscan: 6,
    useAnimationFrameWithResizeObserver: true,
  })
  const measurementKey = useMemo(
    () => virtualizedRows.map(row => `${row.id}:${estimateSize(row)}`).join('|'),
    [estimateSize, virtualizedRows]
  )

  useLayoutEffect(() => {
    if (!effectiveVirtualize || virtualizedRowCount === 0) {
      return
    }
    rowVirtualizer.measure()
  }, [effectiveVirtualize, measurementKey, rowVirtualizer, virtualizedRowCount])

  if (!effectiveVirtualize) {
    return <StaticTimelineContent rows={rows} scrollRef={scrollRef} onScroll={onScroll} className={className} ariaLabel={ariaLabel} emptyState={emptyState} footer={footer} style={style} renderRow={renderRow} />
  }

  return (
    <VirtualizedTimelineContent
      rows={rows}
      scrollRef={scrollRef}
      onScroll={onScroll}
      className={className}
      ariaLabel={ariaLabel}
      emptyState={emptyState}
      footer={footer}
      style={style}
      renderRow={renderRow}
      rowVirtualizer={rowVirtualizer}
      virtualizedRowCount={virtualizedRowCount}
    />
  )
}
