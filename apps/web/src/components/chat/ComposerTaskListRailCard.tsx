import { useMemo, useState } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, LoaderIcon, PauseIcon } from 'lucide-react'
import { cn } from '~/lib/utils'
import { useChatViewCtx } from './ChatViewContext'
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from '../../proposedPlan'
import ChatMarkdown from '../ChatMarkdown'

function stepStatusIcon(status: string): React.ReactNode {
  if (status === 'completed') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <CheckIcon className="size-3" />
      </span>
    )
  }
  if (status === 'inProgress') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <LoaderIcon className="size-3 animate-[spin_2.2s_linear_infinite]" />
      </span>
    )
  }
  if (status === 'paused') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-sky-300">
        <PauseIcon className="size-3" />
      </span>
    )
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400">
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  )
}

function TaskListSteps() {
  const c = useChatViewCtx()
  const activePlan = c.p.activePlan
  if (!activePlan || activePlan.steps.length === 0) {
    return null
  }
  return (
    <div className="space-y-1">
      {activePlan.steps.map(step => (
        <div
          key={`${step.status}:${step.step}`}
          className={cn(
            'flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200',
            step.status === 'inProgress' && 'bg-blue-500/5',
            step.status === 'paused' && 'bg-sky-500/5',
            step.status === 'completed' && 'bg-emerald-500/5'
          )}
        >
          <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
          <p
            className={cn(
              'text-[13px] leading-snug',
              step.status === 'completed'
                ? 'text-muted-foreground/50 line-through decoration-muted-foreground/20'
                : step.status === 'inProgress'
                  ? 'text-foreground/90'
                  : step.status === 'paused'
                    ? 'text-sky-100/85'
                    : 'text-muted-foreground/70'
            )}
          >
            {step.step}
          </p>
        </div>
      ))}
    </div>
  )
}

function ProposedPlanPreview() {
  const c = useChatViewCtx()
  const plan = c.p.sidebarProposedPlan
  const [expanded, setExpanded] = useState(false)
  const title = useMemo(
    () => (plan ? (proposedPlanTitle(plan.planMarkdown) ?? 'Plan proposal') : null),
    [plan]
  )
  const preview = useMemo(
    () =>
      plan ? buildCollapsedProposedPlanPreviewMarkdown(plan.planMarkdown, { maxLines: 6 }) : '',
    [plan]
  )
  const fullMarkdown = useMemo(
    () => (plan ? stripDisplayedPlanMarkdown(plan.planMarkdown) : ''),
    [plan]
  )
  if (!plan) {
    return null
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 text-left"
        onClick={() => setExpanded(value => !value)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
        )}
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/60">
          {title}
        </span>
      </button>
      <div className="rounded-lg border border-border/50 bg-background/50 p-3">
        {expanded ? (
          <ChatMarkdown text={fullMarkdown} cwd={c.gitCwd ?? undefined} isStreaming={false} />
        ) : (
          <ChatMarkdown text={preview} cwd={c.gitCwd ?? undefined} isStreaming={false} />
        )}
      </div>
    </div>
  )
}

function taskListSummary(input: {
  readonly totalSteps: number
  readonly completedSteps: number
  readonly hasProposal: boolean
}) {
  if (input.totalSteps > 0) {
    return `${input.completedSteps}/${input.totalSteps} complete`
  }
  if (input.hasProposal) {
    return 'Plan proposed'
  }
  return 'Task list'
}

export function ComposerTaskListRailCard() {
  const c = useChatViewCtx()
  const activePlan = c.p.activePlan
  const sidebarProposedPlan = c.p.sidebarProposedPlan
  const [collapsed, setCollapsed] = useState(false)

  if (!activePlan && !sidebarProposedPlan) {
    return null
  }

  const totalSteps = activePlan?.steps.length ?? 0
  const completedSteps = activePlan?.steps.filter(step => step.status === 'completed').length ?? 0

  return (
    <div className="px-3 py-2" data-testid="composer-task-list">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left"
        onClick={() => setCollapsed(value => !value)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
            <span className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 font-medium text-foreground/85">
              Task list
            </span>
            <span className="truncate">
              {taskListSummary({
                totalSteps,
                completedSteps,
                hasProposal: Boolean(sidebarProposedPlan),
              })}
            </span>
          </div>
        </div>
        {collapsed ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground/60" />
        )}
      </button>
      {!collapsed ? (
        <div className="mt-2 space-y-3">
          <TaskListSteps />
          <ProposedPlanPreview />
        </div>
      ) : null}
    </div>
  )
}
