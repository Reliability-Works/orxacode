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
import { ZenGate } from '../ZenGate'
import { getHeaderDiffStats } from './ChatViewHeaderPanel.logic'
import { ProviderStatusBanner } from './ProviderStatusBanner'
import { ThreadErrorBanner } from './ThreadErrorBanner'
import { useChatViewCtx } from './ChatViewContext'
import { useSidebar } from '../ui/sidebar.shared'
import { Badge } from '../ui/badge'
import { ThreadHandoffMenu } from './ThreadHandoffMenu'
import { ThreadActionsMenu } from './ThreadActionsMenu'
import { useThreadById } from '../../storeSelectors'
import { formatSubagentLabel } from '@orxa-code/shared/subagent'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useZenMode } from '../../hooks/useZenMode'
import { useChatsBaseDir } from '../../hooks/useChatsBaseDir'
import { isChatProject } from '../../lib/chatProject'

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

function ChatViewHeaderBanners() {
  const c = useChatViewCtx()
  const { td, setThreadError } = c
  const { activeThread, activeProviderStatus } = td
  if (!activeThread) return null
  return (
    <>
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

export function ChatViewHeaderPanel() {
  const c = useChatViewCtx()
  const { td, store, cd, gitCwd } = c
  const { activeThread, activeProject } = td
  const { keybindings, availableEditors } = store
  const { state } = useSidebar()
  const isMobile = useIsMobile()
  const zen = useZenMode()
  const collapsed = state === 'collapsed' || zen.enabled
  const diffStats = useHeaderDiffStats(c.panelDiffQuery.data, c.ls.gitDiffScope)
  const chatBaseDir = useChatsBaseDir()
  const isChatThread = Boolean(activeProject && isChatProject(activeProject, chatBaseDir))
  if (!activeThread) return null
  const worktreeParent =
    activeThread.worktreePath && activeThread.parentBranch
      ? { worktreePath: activeThread.worktreePath, parentBranch: activeThread.parentBranch }
      : null
  const lastInvokedScriptId = activeProject
    ? (c.ls.lastInvokedScriptByProjectId[activeProject.id] ?? null)
    : null
  return (
    <>
      <header
        className={cn(
          'border-b border-border px-3 sm:px-5',
          isElectron ? 'drag-region flex h-[52px] items-center' : 'py-2 sm:py-3'
        )}
        style={
          !isMobile && collapsed
            ? { paddingInlineStart: zen.enabled ? '98px' : APP_TOP_LEFT_BAR_WIDTH }
            : undefined
        }
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
          gitCwd={gitCwd}
          worktreeParent={worktreeParent}
          auxSidebarMode={c.ls.auxSidebarMode}
          diffStats={diffStats}
          onRunProjectScript={script => {
            void c.runProjectScript(script)
          }}
          onAddProjectScript={c.saveProjectScript}
          onUpdateProjectScript={c.updateProjectScript}
          onDeleteProjectScript={c.deleteProjectScript}
          onToggleGitSidebar={c.toggleGitSidebar}
          onToggleFilesSidebar={c.toggleFilesSidebar}
          onToggleBrowserSidebar={c.toggleBrowserSidebar}
          onSelectChatView={c.closeAuxSidebar}
          browserAvailable={Boolean(activeProject) && isElectron}
          isChatThread={isChatThread}
          {...(isChatThread ? {} : { handoffAction: <HandoffMenuAction /> })}
          threadActionsMenu={
            <ZenGate id="chat.threadActions">
              <ThreadActionsMenu thread={activeThread} project={activeProject ?? null} />
            </ZenGate>
          }
        />
      </header>
      <ChatViewHeaderBanners />
    </>
  )
}
