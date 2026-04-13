import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface ComposerRailSectionCardProps {
  readonly testId: string
  readonly badgeLabel: string
  readonly summary: string
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}

export function ComposerRailSectionCard(props: ComposerRailSectionCardProps) {
  return (
    <div className="px-3 py-2" data-testid={props.testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left"
        onClick={props.onToggle}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-caption text-muted-foreground/80">
            <span className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 font-medium text-foreground/85">
              {props.badgeLabel}
            </span>
            <span className="truncate">{props.summary}</span>
          </div>
        </div>
        {props.collapsed ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground/60" />
        )}
      </button>
      {!props.collapsed ? props.children : null}
    </div>
  )
}
