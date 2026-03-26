import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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
  /** When this value changes, scroll is instantly snapped to the bottom (session switch). */
  sessionId?: string;
};

const DEFAULT_UNVIRTUALIZED_TAIL_ROWS = 8;
const VIRTUALIZED_ROW_GAP_PX = 10;
const AUTOSCROLL_BOOTSTRAP_IDLE_MS = 160;

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
  sessionId,
}: VirtualizedTimelineProps<Row>) {
  // ── Scroll-snap on session switch ──────────────────────────────────
  // When sessionId changes (or the component mounts with a sessionId)
  // we instantly snap the scroll container to the bottom so the user
  // never sees the top of a long conversation flash by.
  //
  // Cross-provider switches (e.g. OpenCode → Codex) unmount the old
  // pane and mount a new VirtualizedTimeline. On that first mount the
  // rows are often still empty (data hydrates async), so scrollHeight
  // is ~0 and the snap is a no-op. We track a "pending snap" flag so
  // that the auto-scroll effect uses *instant* (not smooth) scrolling
  // until the first batch of rows has been snapped into view.
  const UNSET = Symbol.for("vt:unset");
  const prevSessionIdRef = useRef<string | symbol>(UNSET);
  const isAtBottomRef = useRef(true);
  const pendingSnapRef = useRef(sessionId != null);
  const skipNextSmoothScrollRef = useRef(false);
  const bootstrapAutoscrollRef = useRef(sessionId != null);
  const bootstrapTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (sessionId != null && prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        skipNextSmoothScrollRef.current = true;
        bootstrapAutoscrollRef.current = true;
        // If there was actual content to snap to, the snap is done.
        // Otherwise keep the pending flag so auto-scroll handles it.
        pendingSnapRef.current = el.scrollHeight <= el.clientHeight;
      } else {
        pendingSnapRef.current = true;
      }
      isAtBottomRef.current = true;
      if (bootstrapTimerRef.current != null) {
        window.clearTimeout(bootstrapTimerRef.current);
        bootstrapTimerRef.current = null;
      }
    }
  }, [sessionId, scrollRef]);

  // Track whether user is near the bottom (within 50px)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const track = () => {
      isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    };
    el.addEventListener("scroll", track, { passive: true });
    return () => el.removeEventListener("scroll", track);
  }, [scrollRef]);

  // Complete a pending session-switch snap in layout phase so rows hydrate
  // directly at the bottom before paint (prevents top-of-history flash).
  useLayoutEffect(() => {
    if (!pendingSnapRef.current || !isAtBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    skipNextSmoothScrollRef.current = true;
    bootstrapAutoscrollRef.current = true;
    if (rows.length > 0 || el.scrollHeight > el.clientHeight) {
      pendingSnapRef.current = false;
    }
  }, [rows.length, scrollRef]);

  // Keep initial hydration updates (which can arrive in bursts) instant.
  // Smooth auto-scroll resumes only after rows stop changing for a short idle window.
  useEffect(() => {
    if (!bootstrapAutoscrollRef.current) {
      return;
    }
    if (bootstrapTimerRef.current != null) {
      window.clearTimeout(bootstrapTimerRef.current);
    }
    bootstrapTimerRef.current = window.setTimeout(() => {
      bootstrapAutoscrollRef.current = false;
      bootstrapTimerRef.current = null;
    }, AUTOSCROLL_BOOTSTRAP_IDLE_MS);
  }, [rows.length, sessionId]);

  useEffect(() => () => {
    if (bootstrapTimerRef.current != null) {
      window.clearTimeout(bootstrapTimerRef.current);
      bootstrapTimerRef.current = null;
    }
  }, []);

  // Auto-scroll when new rows arrive and user is at the bottom.
  // Once the pending session-switch snap is cleared, use smooth scrolling.
  useEffect(() => {
    if (!isAtBottomRef.current || pendingSnapRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (bootstrapAutoscrollRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (skipNextSmoothScrollRef.current) {
      skipNextSmoothScrollRef.current = false;
      return;
    }
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [rows.length, scrollRef]);

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
