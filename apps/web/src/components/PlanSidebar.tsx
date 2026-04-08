import { memo, useState, useCallback } from 'react'
import { type TimestampFormat } from '@orxa-code/contracts/settings'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import ChatMarkdown from './ChatMarkdown'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  LoaderIcon,
  PanelRightCloseIcon,
} from 'lucide-react'
import { cn } from '~/lib/utils'
import type { ActivePlanState } from '../session-logic'
import type { LatestProposedPlanState } from '../session-logic'
import { formatTimestamp } from '../timestampFormat'
import {
  proposedPlanTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  downloadPlanAsTextFile,
  stripDisplayedPlanMarkdown,
} from '../proposedPlan'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from './ui/menu'
import { readNativeApi } from '~/nativeApi'
import { toastManager } from './ui/toastState'
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard'

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
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    )
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  )
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null
  activeProposedPlan: LatestProposedPlanState | null
  markdownCwd: string | undefined
  workspaceRoot: string | undefined
  timestampFormat: TimestampFormat
  onClose: () => void
}

function PlanSidebarActionsMenu(props: {
  isCopied: boolean
  workspaceRoot: string | undefined
  isSavingToWorkspace: boolean
  onCopyPlan: () => void
  onDownload: () => void
  onSaveToWorkspace: () => void
}) {
  const {
    isCopied,
    workspaceRoot,
    isSavingToWorkspace,
    onCopyPlan,
    onDownload,
    onSaveToWorkspace,
  } = props
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground/50 hover:text-foreground/70"
            aria-label="Plan actions"
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={onCopyPlan}>{isCopied ? 'Copied!' : 'Copy to clipboard'}</MenuItem>
        <MenuItem onClick={onDownload}>Download as markdown</MenuItem>
        <MenuItem onClick={onSaveToWorkspace} disabled={!workspaceRoot || isSavingToWorkspace}>
          Save to workspace
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}

function PlanSidebarHeader(props: {
  activePlan: ActivePlanState | null
  timestampFormat: TimestampFormat
  planMarkdown: string | null
  isCopied: boolean
  workspaceRoot: string | undefined
  isSavingToWorkspace: boolean
  onCopyPlan: () => void
  onDownload: () => void
  onSaveToWorkspace: () => void
  onClose: () => void
}) {
  const {
    activePlan,
    timestampFormat,
    planMarkdown,
    isCopied,
    workspaceRoot,
    isSavingToWorkspace,
    onCopyPlan,
    onDownload,
    onSaveToWorkspace,
    onClose,
  } = props
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-blue-400 uppercase"
        >
          Plan
        </Badge>
        {activePlan ? (
          <span className="text-[11px] text-muted-foreground/60">
            {formatTimestamp(activePlan.createdAt, timestampFormat)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {planMarkdown ? (
          <PlanSidebarActionsMenu
            isCopied={isCopied}
            workspaceRoot={workspaceRoot}
            isSavingToWorkspace={isSavingToWorkspace}
            onCopyPlan={onCopyPlan}
            onDownload={onDownload}
            onSaveToWorkspace={onSaveToWorkspace}
          />
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close plan sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function PlanSidebarSteps(props: { activePlan: ActivePlanState }) {
  const { activePlan } = props
  if (activePlan.steps.length === 0) {
    return null
  }

  return (
    <div className="space-y-1">
      <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
        Steps
      </p>
      {activePlan.steps.map(step => (
        <div
          key={`${step.status}:${step.step}`}
          className={cn(
            'flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200',
            step.status === 'inProgress' && 'bg-blue-500/5',
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

function ProposedPlanMarkdownSection(props: {
  planMarkdown: string
  planTitle: string | null
  displayedPlanMarkdown: string | null
  markdownCwd: string | undefined
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const {
    planMarkdown,
    planTitle,
    displayedPlanMarkdown,
    markdownCwd,
    expanded,
    onToggleExpanded,
  } = props
  void planMarkdown
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="group flex w-full items-center gap-1.5 text-left"
        onClick={onToggleExpanded}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
        )}
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/60">
          {planTitle ?? 'Full Plan'}
        </span>
      </button>
      {expanded ? (
        <div className="rounded-lg border border-border/50 bg-background/50 p-3">
          <ChatMarkdown text={displayedPlanMarkdown ?? ''} cwd={markdownCwd} isStreaming={false} />
        </div>
      ) : null}
    </div>
  )
}

function PlanSidebarEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
      <p className="mt-1 text-[11px] text-muted-foreground/30">
        Plans will appear here when generated.
      </p>
    </div>
  )
}

function usePlanSidebarActions(props: {
  planMarkdown: string | null
  workspaceRoot: string | undefined
  copyToClipboard: (text: string) => void
  setIsSavingToWorkspace: (value: boolean) => void
}) {
  const { planMarkdown, workspaceRoot, copyToClipboard, setIsSavingToWorkspace } = props

  const handleCopyPlan = useCallback(() => {
    if (!planMarkdown) return
    copyToClipboard(planMarkdown)
  }, [planMarkdown, copyToClipboard])

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return
    const filename = buildProposedPlanMarkdownFilename(planMarkdown)
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown))
  }, [planMarkdown])

  const handleSaveToWorkspace = useCallback(() => {
    const api = readNativeApi()
    if (!api || !workspaceRoot || !planMarkdown) return
    const filename = buildProposedPlanMarkdownFilename(planMarkdown)
    setIsSavingToWorkspace(true)
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then(result => {
        toastManager.add({
          type: 'success',
          title: 'Plan saved',
          description: result.relativePath,
        })
      })
      .catch(error => {
        toastManager.add({
          type: 'error',
          title: 'Could not save plan',
          description: error instanceof Error ? error.message : 'An error occurred.',
        })
      })
      .then(
        () => setIsSavingToWorkspace(false),
        () => setIsSavingToWorkspace(false)
      )
  }, [planMarkdown, workspaceRoot, setIsSavingToWorkspace])

  return { handleCopyPlan, handleDownload, handleSaveToWorkspace }
}

function PlanSidebarContent(props: {
  activePlan: ActivePlanState | null
  planMarkdown: string | null
  planTitle: string | null
  displayedPlanMarkdown: string | null
  markdownCwd: string | undefined
  proposedPlanExpanded: boolean
  onToggleExpanded: () => void
}) {
  const {
    activePlan,
    planMarkdown,
    planTitle,
    displayedPlanMarkdown,
    markdownCwd,
    proposedPlanExpanded,
    onToggleExpanded,
  } = props
  return (
    <div className="p-3 space-y-4">
      {activePlan?.explanation ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground/80">
          {activePlan.explanation}
        </p>
      ) : null}

      {activePlan ? <PlanSidebarSteps activePlan={activePlan} /> : null}

      {planMarkdown ? (
        <ProposedPlanMarkdownSection
          planMarkdown={planMarkdown}
          planTitle={planTitle}
          displayedPlanMarkdown={displayedPlanMarkdown}
          markdownCwd={markdownCwd}
          expanded={proposedPlanExpanded}
          onToggleExpanded={onToggleExpanded}
        />
      ) : null}

      {!activePlan && !planMarkdown ? <PlanSidebarEmptyState /> : null}
    </div>
  )
}

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  markdownCwd,
  workspaceRoot,
  timestampFormat,
  onClose,
}: PlanSidebarProps) {
  const [proposedPlanExpanded, setProposedPlanExpanded] = useState(false)
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false)
  const { copyToClipboard, isCopied } = useCopyToClipboard()

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null
  const { handleCopyPlan, handleDownload, handleSaveToWorkspace } = usePlanSidebarActions({
    planMarkdown,
    workspaceRoot,
    copyToClipboard,
    setIsSavingToWorkspace,
  })

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <PlanSidebarHeader
        activePlan={activePlan}
        timestampFormat={timestampFormat}
        planMarkdown={planMarkdown}
        isCopied={isCopied}
        workspaceRoot={workspaceRoot}
        isSavingToWorkspace={isSavingToWorkspace}
        onCopyPlan={handleCopyPlan}
        onDownload={handleDownload}
        onSaveToWorkspace={handleSaveToWorkspace}
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">
        <PlanSidebarContent
          activePlan={activePlan}
          planMarkdown={planMarkdown}
          planTitle={planTitle}
          displayedPlanMarkdown={displayedPlanMarkdown}
          markdownCwd={markdownCwd}
          proposedPlanExpanded={proposedPlanExpanded}
          onToggleExpanded={() => setProposedPlanExpanded(value => !value)}
        />
      </ScrollArea>
    </div>
  )
})

export default PlanSidebar
export type { PlanSidebarProps }
