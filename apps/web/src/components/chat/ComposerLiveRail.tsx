import { cn } from '~/lib/utils'
import { useChatViewCtx } from './ChatViewContext'
import { ComposerTaskListRailCard } from './ComposerTaskListRailCard'
import {
  ComposerQueuedMessagesRailCard,
  type ComposerLiveRailCardProps,
} from './ComposerQueuedMessagesTray'

function ComposerLiveRailCard({
  children,
  stackIndex,
  className,
  testId,
}: ComposerLiveRailCardProps & {
  readonly stackIndex: number
}) {
  const isTop = stackIndex === 0
  return (
    <div
      className={cn(
        'border border-border/80 bg-muted/55 backdrop-blur-sm',
        isTop ? 'rounded-t-[18px]' : 'border-t-0',
        'rounded-b-none',
        stackIndex > 0 && 'border-b-0',
        className
      )}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </div>
  )
}

export function ComposerLiveRail() {
  const c = useChatViewCtx()
  const cards: Array<Omit<ComposerLiveRailCardProps, 'stackIndex' | 'stackSize'>> = []

  if (c.ls.queuedComposerMessages.length > 0) {
    cards.push({
      testId: 'composer-queued-messages',
      children: <ComposerQueuedMessagesRailCard />,
    })
  }
  if (c.p.activePlan || c.p.sidebarProposedPlan) {
    cards.push({
      testId: 'composer-task-list-card',
      children: <ComposerTaskListRailCard />,
    })
  }

  if (cards.length === 0) {
    return null
  }

  return (
    <div className="mx-4 -mb-px sm:mx-6" data-testid="composer-live-rail">
      {cards.map((card, index) => (
        <ComposerLiveRailCard
          key={card.testId ?? index}
          stackIndex={index}
          {...(card.className ? { className: card.className } : {})}
          {...(card.testId ? { testId: card.testId } : {})}
        >
          {card.children}
        </ComposerLiveRailCard>
      ))}
    </div>
  )
}
