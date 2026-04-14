/**
 * ChatView header + status/error banners panel.
 *
 * Extracted from ChatView.tsx to satisfy max-lines and keep the root shell thin.
 */

import { useMemo } from 'react'
import { cn } from '~/lib/utils'
import { isElectron } from '../../env'
import { APP_TOP_LEFT_BAR_WIDTH } from '../AppTopLeftBar'
import { ChatHeader } from './ChatHeader'
import { getHeaderDiffStats } from './ChatViewHeaderPanel.logic'
import { ProviderStatusBanner } from './ProviderStatusBanner'
import { ThreadErrorBanner } from './ThreadErrorBanner'
import { useChatViewCtx } from './ChatViewContext'
import { useSidebar } from '../ui/sidebar.shared'
import { useChatSplitPaneContext } from './ChatSplitPaneContext'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Columns2Icon, Maximize2Icon } from 'lucide-react'
import { ThreadHandoffMenu } from './ThreadHandoffMenu'
import { ThreadActionsMenu } from './ThreadActionsMenu'
import { useThreadById } from '../../storeSelectors'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { formatSubagentLabel } from '@orxa-code/shared/subagent'
import { useIsMobile } from '../../hooks/useMediaQuery'

function HandoffMenuAction() {
  const c = useChatViewCtx()
  if (!c.td.activeThread) return null
  return (
    <ThreadHandoffMenu
      thread={c.td.activeThread}
      project={c.td.activeProject ?? null}
      modelOptionsByProvider={c.td.modelOptionsByProvider}
      {...(c.td.canCheckoutPullRequestIntoThread
        ? { onOpenPullRequestDialog: c.openPullRequestDialog }
        : {})}
    />
  )
}

function ChatHeaderSplitActions() {
  const split = useChatSplitPaneContext()
  if (!split) return null
  if (!split.splitOpen) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              onClick={split.toggleSplit}
              aria-label="Open split view"
            />
          }
        >
          <Columns2Icon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Open split view</TooltipPopup>
      </Tooltip>
    )
  }

  // Split is open: drop the (redundant) Columns2 toggle — the secondary pane
  // carries its own close (X) control. Keep the Maximize affordance so the
  // primary pane can still be expanded to full width.
  const isSplitMaximized = split.maximizedPane === split.pane
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant={isSplitMaximized ? 'secondary' : 'outline'}
            onClick={split.toggleMaximize}
            aria-label={isSplitMaximized ? 'Restore split view' : `Maximize ${split.pane} pane`}
          />
        }
      >
        <Maximize2Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {isSplitMaximized ? 'Restore split view' : `Maximize ${split.pane} pane`}
      </TooltipPopup>
    </Tooltip>
  )
}

function useHeaderDiffStats(
  diffData: ReturnType<typeof useChatViewCtx>['panelDiffQuery']['data'],
  scope: ReturnType<typeof useChatViewCtx>['ls']['gitDiffScope']
) {
  return useMemo(() => getHeaderDiffStats(diffData, scope), [diffData, scope])
}

function ChatHeaderHandoffBanner() {
  const c = useChatViewCtx()
  const handoff = c.td.activeThread?.handoff
  if (!handoff) return null
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-2 sm:px-5">
      <Badge variant="outline" className="text-mini uppercase tracking-wide">
        Handoff
      </Badge>
      <p className="truncate text-xs text-muted-foreground">
        From {handoff.sourceProvider} to {handoff.targetProvider} via {handoff.sourceThreadTitle}
      </p>
    </div>
  )
}

function ChatHeaderSubagentBanner() {
  const c = useChatViewCtx()
  const thread = c.td.activeThread
  const parentLink = thread?.parentLink
  const parentThread = useThreadById(parentLink?.parentThreadId)
  if (!thread || !parentLink) return null
  const parentThreadTitle = parentThread?.title ?? 'Parent thread'
  const subagentLabel = formatSubagentLabel(
    parentLink.agentLabel ??
      (thread.modelSelection.provider === 'opencode' ? thread.modelSelection.agentId : null)
  )
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-2 sm:px-5">
      <Badge variant="outline" className="text-mini uppercase tracking-wide">
        Subagent
      </Badge>
      <p className="truncate text-xs text-muted-foreground">
        {subagentLabel ? `${subagentLabel} · ` : ''}
        {thread.modelSelection.provider} / {thread.modelSelection.model} from {parentThreadTitle}
      </p>
    </div>
  )
}

export function ChatViewHeaderPanel() {
  const c = useChatViewCtx()
  const { td, store, cd, gitCwd, setThreadError } = c
  const { activeThread, activeProject, activeProviderStatus } = td
  const { keybindings, availableEditors, terminalState } = store
  const { state } = useSidebar()
  const isMobile = useIsMobile()
  const collapsed = state === 'collapsed'
  const diffStats = useHeaderDiffStats(c.panelDiffQuery.data, c.ls.gitDiffScope)
  if (!activeThread) return null
  const lastInvokedScriptId = activeProject
    ? (c.ls.lastInvokedScriptByProjectId[activeProject.id] ?? null)
    : null
  const browserAvailable = Boolean(activeProject) && isElectron
  return (
    <>
      <header
        className={cn(
          'border-b border-border px-3 sm:px-5',
          isElectron ? 'drag-region flex h-[52px] items-center' : 'py-2 sm:py-3'
        )}
        style={!isMobile && collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined}
      >
        <ChatHeader
          activeThreadId={activeThread.id}
          activeThreadTitle={activeThread.title}
          activeProjectName={activeProject?.name}
          isGitRepo={cd.isGitRepo}
          openInCwd={gitCwd}
          activeProjectScripts={activeProject?.scripts}
          preferredScriptId={lastInvokedScriptId}
          keybindings={keybindings}
          availableEditors={availableEditors}
          terminalAvailable={activeProject !== undefined}
          terminalOpen={terminalState.terminalOpen}
          terminalToggleShortcutLabel={cd.terminalToggleShortcutLabel}
          gitCwd={gitCwd}
          auxSidebarMode={c.ls.auxSidebarMode}
          diffStats={diffStats}
          onRunProjectScript={script => {
            void c.runProjectScript(script)
          }}
          onAddProjectScript={c.saveProjectScript}
          onUpdateProjectScript={c.updateProjectScript}
          onDeleteProjectScript={c.deleteProjectScript}
          onToggleTerminal={c.toggleTerminalVisibility}
          onToggleGitSidebar={c.toggleGitSidebar}
          onToggleFilesSidebar={c.toggleFilesSidebar}
          onToggleBrowserSidebar={c.toggleBrowserSidebar}
          onSelectChatView={c.closeAuxSidebar}
          browserAvailable={browserAvailable}
          splitActions={<ChatHeaderSplitActions />}
          handoffAction={<HandoffMenuAction />}
          threadActionsMenu={
            <ThreadActionsMenu thread={activeThread} project={activeProject ?? null} />
          }
        />
      </header>
      <ChatHeaderSubagentBanner />
      <ChatHeaderHandoffBanner />
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
    </>
  )
}
