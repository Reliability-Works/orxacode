import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { type WheelEvent as ReactWheelEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { TurnId } from '@orxa-code/contracts'
import { cn } from '~/lib/utils'
import { formatShortTimestamp } from '../timestampFormat'
import type { useSettings } from '../hooks/useSettings'

interface TurnDiffSummary {
  turnId: TurnId
  completedAt: string
  checkpointTurnCount?: number | undefined
}

interface DiffPanelTurnStripProps {
  orderedTurnDiffSummaries: TurnDiffSummary[]
  inferredCheckpointTurnCountByTurnId: Record<string, number>
  selectedTurnId: TurnId | null
  selectedTurn: TurnDiffSummary | undefined
  timestampFormat: ReturnType<typeof useSettings>['timestampFormat']
  onSelectWholeConversation: () => void
  onSelectTurn: (turnId: TurnId) => void
}

function useTurnStripScroll(
  orderedTurnDiffSummaries: TurnDiffSummary[],
  selectedTurnId: TurnId | null,
  selectedTurn: TurnDiffSummary | undefined
) {
  const turnStripRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const element = turnStripRef.current
    if (!element) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    setCanScrollLeft(element.scrollLeft > 4)
    setCanScrollRight(element.scrollLeft < maxScrollLeft - 4)
  }, [])

  const scrollBy = useCallback((offset: number) => {
    const element = turnStripRef.current
    if (!element) return
    element.scrollBy({ left: offset, behavior: 'smooth' })
  }, [])

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current
    if (!element) return
    if (element.scrollWidth <= element.clientWidth + 1) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    element.scrollBy({ left: event.deltaY, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const element = turnStripRef.current
    if (!element) return
    const frameId = window.requestAnimationFrame(() => updateScrollState())
    const onScroll = () => updateScrollState()
    element.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => updateScrollState())
    resizeObserver.observe(element)
    return () => {
      window.cancelAnimationFrame(frameId)
      element.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [updateScrollState])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateScrollState())
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [orderedTurnDiffSummaries, selectedTurnId, updateScrollState])

  useEffect(() => {
    const element = turnStripRef.current
    if (!element) return
    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']")
    selectedChip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [selectedTurn?.turnId, selectedTurnId])

  return { turnStripRef, canScrollLeft, canScrollRight, scrollBy, onWheel }
}

interface TurnChipListProps {
  turnStripRef: React.RefObject<HTMLDivElement | null>
  orderedTurnDiffSummaries: TurnDiffSummary[]
  inferredCheckpointTurnCountByTurnId: Record<string, number>
  selectedTurnId: TurnId | null
  selectedTurn: TurnDiffSummary | undefined
  timestampFormat: ReturnType<typeof useSettings>['timestampFormat']
  onSelectWholeConversation: () => void
  onSelectTurn: (turnId: TurnId) => void
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
}

import type React from 'react'

function TurnChipList({
  turnStripRef,
  orderedTurnDiffSummaries,
  inferredCheckpointTurnCountByTurnId,
  selectedTurnId,
  selectedTurn,
  timestampFormat,
  onSelectWholeConversation,
  onSelectTurn,
  onWheel,
}: TurnChipListProps) {
  return (
    <div
      ref={turnStripRef}
      className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
      onWheel={onWheel}
    >
      <button
        type="button"
        className="shrink-0 rounded-md"
        onClick={onSelectWholeConversation}
        data-turn-chip-selected={selectedTurnId === null}
      >
        <div
          className={cn(
            'rounded-md border px-2 py-1 text-left transition-colors',
            selectedTurnId === null
              ? 'border-border bg-accent text-accent-foreground'
              : 'border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80'
          )}
        >
          <div className="text-[10px] leading-tight font-medium">All turns</div>
        </div>
      </button>
      {orderedTurnDiffSummaries.map(summary => (
        <button
          key={summary.turnId}
          type="button"
          className="shrink-0 rounded-md"
          onClick={() => onSelectTurn(summary.turnId)}
          title={summary.turnId}
          data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
        >
          <div
            className={cn(
              'rounded-md border px-2 py-1 text-left transition-colors',
              summary.turnId === selectedTurn?.turnId
                ? 'border-border bg-accent text-accent-foreground'
                : 'border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80'
            )}
          >
            <div className="flex items-center gap-1">
              <span className="text-[10px] leading-tight font-medium">
                Turn{' '}
                {summary.checkpointTurnCount ??
                  inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                  '?'}
              </span>
              <span className="text-[9px] leading-tight opacity-70">
                {formatShortTimestamp(summary.completedAt, timestampFormat)}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

export function DiffPanelTurnStrip({
  orderedTurnDiffSummaries,
  inferredCheckpointTurnCountByTurnId,
  selectedTurnId,
  selectedTurn,
  timestampFormat,
  onSelectWholeConversation,
  onSelectTurn,
}: DiffPanelTurnStripProps) {
  const { turnStripRef, canScrollLeft, canScrollRight, scrollBy, onWheel } = useTurnStripScroll(
    orderedTurnDiffSummaries,
    selectedTurnId,
    selectedTurn
  )
  const scrollBtnBase =
    'absolute top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors'

  return (
    <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-linear-to-r from-card to-transparent" />
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-linear-to-l from-card to-transparent" />
      )}
      <button
        type="button"
        className={cn(
          scrollBtnBase,
          'left-0',
          canScrollLeft
            ? 'border-border/70 hover:border-border hover:text-foreground'
            : 'cursor-not-allowed border-border/40 text-muted-foreground/40'
        )}
        onClick={() => scrollBy(-180)}
        disabled={!canScrollLeft}
        aria-label="Scroll turn list left"
      >
        <ChevronLeftIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={cn(
          scrollBtnBase,
          'right-0',
          canScrollRight
            ? 'border-border/70 hover:border-border hover:text-foreground'
            : 'cursor-not-allowed border-border/40 text-muted-foreground/40'
        )}
        onClick={() => scrollBy(180)}
        disabled={!canScrollRight}
        aria-label="Scroll turn list right"
      >
        <ChevronRightIcon className="size-3.5" />
      </button>
      <TurnChipList
        turnStripRef={turnStripRef}
        orderedTurnDiffSummaries={orderedTurnDiffSummaries}
        inferredCheckpointTurnCountByTurnId={inferredCheckpointTurnCountByTurnId}
        selectedTurnId={selectedTurnId}
        selectedTurn={selectedTurn}
        timestampFormat={timestampFormat}
        onSelectWholeConversation={onSelectWholeConversation}
        onSelectTurn={onSelectTurn}
        onWheel={onWheel}
      />
    </div>
  )
}
