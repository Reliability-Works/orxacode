import { Fragment, useLayoutEffect, useMemo, type CSSProperties, type ReactNode, type RefObject } from "react";
import { measureElement, type VirtualItem, useVirtualizer } from "@tanstack/react-virtual";

export type VirtualizedTimelineRow = {
  id: string;
};

type VirtualizedTimelineProps<Row extends VirtualizedTimelineRow> = {
  rows: Row[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  className?: string;
  ariaLabel?: string;
  emptyState?: ReactNode;
  footer?: ReactNode;
  tailCount?: number;
  virtualize?: boolean;
  estimateSize: (row: Row) => number;
  renderRow: (row: Row, virtualRow?: VirtualItem) => ReactNode;
  style?: CSSProperties;
};

const DEFAULT_UNVIRTUALIZED_TAIL_ROWS = 8;
const VIRTUALIZED_ROW_GAP_PX = 10;

export function VirtualizedTimeline<Row extends VirtualizedTimelineRow>({
  rows,
  scrollRef,
  onScroll,
  className = "messages-scroll",
  ariaLabel,
  emptyState,
  footer,
  tailCount = DEFAULT_UNVIRTUALIZED_TAIL_ROWS,
  virtualize = true,
  estimateSize,
  renderRow,
  style,
}: VirtualizedTimelineProps<Row>) {
  const effectiveVirtualize = virtualize;
  const virtualizedRowCount = effectiveVirtualize ? Math.max(rows.length - tailCount, 0) : 0;
  const virtualizedRows = rows.slice(0, virtualizedRowCount);
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index: number) => rows[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = rows[index];
      if (!row) {
        return 96;
      }
      const gap = index === virtualizedRowCount - 1 ? 0 : VIRTUALIZED_ROW_GAP_PX;
      return estimateSize(row) + gap;
    },
    measureElement,
    overscan: 6,
    useAnimationFrameWithResizeObserver: true,
  });
  const measurementKey = useMemo(
    () => virtualizedRows.map((row) => `${row.id}:${estimateSize(row)}`).join("|"),
    [estimateSize, virtualizedRows],
  );

  useLayoutEffect(() => {
    if (!effectiveVirtualize || virtualizedRowCount === 0) {
      return;
    }
    rowVirtualizer.measure();
  }, [effectiveVirtualize, measurementKey, rowVirtualizer, virtualizedRowCount]);

  if (!effectiveVirtualize) {
    return (
      <div ref={scrollRef} className={className} role={ariaLabel ? "log" : undefined} aria-label={ariaLabel} onScroll={onScroll} style={style}>
        {rows.length === 0 ? emptyState : null}
        {rows.map((row) => (
          <Fragment key={`row:${row.id}`}>
            {renderRow(row)}
          </Fragment>
        ))}
        {footer}
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);

  return (
    <div ref={scrollRef} className={className} role={ariaLabel ? "log" : undefined} aria-label={ariaLabel} onScroll={onScroll} style={style}>
      {rows.length === 0 ? emptyState : null}

      {virtualizedRowCount > 0 ? (
        <div className="messages-virtual-spacer" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) {
              return null;
            }
            return (
              <div
                key={`virtual-row:${row.id}`}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="messages-virtual-row"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: virtualRow.index === virtualizedRowCount - 1 ? 0 : `${VIRTUALIZED_ROW_GAP_PX}px`,
                  boxSizing: "border-box",
                }}
              >
                {renderRow(row, virtualRow)}
              </div>
            );
          })}
        </div>
      ) : null}

      {nonVirtualizedRows.map((row) => (
        <Fragment key={`tail-row:${row.id}`}>
          {renderRow(row)}
        </Fragment>
      ))}
      {footer}
    </div>
  );
}
