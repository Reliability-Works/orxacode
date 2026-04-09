/**
 * ChatView inner layout — composes header, messages pane, composer, sidebars.
 *
 * Extracted from ChatView.tsx. Split into small sub-components so the root
 * layout stays under max-lines-per-function.
 */

import { cn } from '~/lib/utils'
import BranchToolbar from '../BranchToolbar'
import { FilesSidebar } from '../files-sidebar/FilesSidebar'
import PlanSidebar from '../PlanSidebar'
import ThreadTerminalDrawer from '../ThreadTerminalDrawer'
import { PullRequestThreadDialog } from '../PullRequestThreadDialog'
import { GitSidebar } from '../git-sidebar/GitSidebar'
import { BrowserSidebar } from '../browser-sidebar/BrowserSidebar'
import { ChatViewHeaderPanel } from './ChatViewHeaderPanel'
import { ChatViewMessagesPane } from './ChatViewMessagesPane'
import { ChatViewComposerBody } from './ChatViewComposerBody'
import { ChatViewImageOverlayCtx } from './ChatViewImageOverlayCtx'
import { useChatViewCtx } from './ChatViewContext'
import { useChatAuxSidebarResize } from './ChatViewAuxSidebar.resize'

function ChatViewComposerForm() {
  const c = useChatViewCtx()
  const { composerFormRef } = c.scroll.refs
  const isGitRepo = c.cd.isGitRepo
  return (
    <div className={cn('px-3 pt-1.5 sm:px-5 sm:pt-2', isGitRepo ? 'pb-1' : 'pb-3 sm:pb-4')}>
      <form
        ref={composerFormRef}
        onSubmit={c.onSend}
        className="mx-auto w-full min-w-0 max-w-[52rem]"
        data-chat-composer-form="true"
      >
        <ChatViewComposerBody />
      </form>
    </div>
  )
}

function ChatViewBranchToolbarBlock() {
  const c = useChatViewCtx()
  const { td } = c
  if (!td.activeThread || !c.cd.isGitRepo) return null
  return (
    <BranchToolbar
      threadId={td.activeThread.id}
      onEnvModeChange={c.onEnvModeChange}
      envLocked={td.isServerThread}
      onComposerFocusRequest={c.scheduleComposerFocus}
      {...(td.canCheckoutPullRequestIntoThread
        ? { onCheckoutPullRequestRequest: c.openPullRequestDialog }
        : {})}
    />
  )
}

function ChatViewPullRequestDialogBlock() {
  const c = useChatViewCtx()
  const { activeProject } = c.td
  const dialogState = c.ls.pullRequestDialogState
  if (!dialogState) return null
  return (
    <PullRequestThreadDialog
      key={dialogState.key}
      open
      cwd={activeProject?.cwd ?? null}
      initialReference={dialogState.initialReference}
      onOpenChange={open => {
        if (!open) c.closePullRequestDialog()
      }}
      onPrepared={c.handlePreparedPullRequestThread}
    />
  )
}

function ChatViewPlanSidebarBlock() {
  const c = useChatViewCtx()
  const { p, store, gitCwd } = c
  const { activeProject } = c.td
  if (!c.ls.planSidebarOpen) return null
  return (
    <PlanSidebar
      activePlan={p.activePlan}
      activeProposedPlan={p.sidebarProposedPlan}
      markdownCwd={gitCwd ?? undefined}
      workspaceRoot={activeProject?.cwd ?? undefined}
      timestampFormat={store.settings.timestampFormat}
      onClose={c.closePlanSidebar}
    />
  )
}

function ChatViewAuxSidebarShell(props: { children: React.ReactNode }) {
  const c = useChatViewCtx()
  const resize = useChatAuxSidebarResize(c.ls.auxSidebarWidth, c.ls.setAuxSidebarWidth)

  return (
    <div
      className="relative flex h-full shrink-0"
      style={{ width: `${resize.sidebarWidth}px` }}
      data-chat-aux-sidebar="true"
    >
      <div
        className="absolute inset-y-0 left-0 z-20 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center touch-none"
        onPointerDown={resize.handleResizePointerDown}
        onPointerMove={resize.handleResizePointerMove}
        onPointerUp={resize.handleResizePointerEnd}
        onPointerCancel={resize.handleResizePointerEnd}
        aria-hidden="true"
      >
        <span className="h-full w-px bg-border/80 transition-colors hover:bg-border" />
      </div>
      <div className="min-w-0 flex-1">{props.children}</div>
    </div>
  )
}

function ChatViewAuxSidebarBlock() {
  const c = useChatViewCtx()
  const { gitCwd, td } = c
  if (c.ls.auxSidebarMode === 'none') return null
  if (c.ls.auxSidebarMode === 'browser') {
    if (!td.activeProject) return null
    return (
      <ChatViewAuxSidebarShell>
        <BrowserSidebar onClose={c.closeAuxSidebar} />
      </ChatViewAuxSidebarShell>
    )
  }
  if (!gitCwd) return null
  if (c.ls.auxSidebarMode === 'files') {
    return (
      <ChatViewAuxSidebarShell>
        <FilesSidebar
          cwd={gitCwd}
          onClose={c.closeAuxSidebar}
          onInsertPath={c.insertComposerPathReference}
        />
      </ChatViewAuxSidebarShell>
    )
  }
  if (!c.cd.isGitRepo) return null
  return (
    <ChatViewAuxSidebarShell>
      <GitSidebar
        cwd={gitCwd}
        diffQueryResult={c.panelDiffQuery}
        diffScope={c.ls.gitDiffScope}
        onDiffScopeChange={c.ls.setGitDiffScope}
        onClose={c.closeAuxSidebar}
      />
    </ChatViewAuxSidebarShell>
  )
}

function ChatViewTerminalDrawerBlock() {
  const c = useChatViewCtx()
  const { store, gitCwd } = c
  const { activeThread, activeProject } = c.td
  if (!store.terminalState.terminalOpen || !activeProject || !activeThread) return null
  return (
    <ThreadTerminalDrawer
      key={activeThread.id}
      threadId={activeThread.id}
      cwd={gitCwd ?? activeProject.cwd}
      runtimeEnv={c.threadTerminalRuntimeEnv}
      height={store.terminalState.terminalHeight}
      terminalIds={store.terminalState.terminalIds}
      activeTerminalId={store.terminalState.activeTerminalId}
      terminalGroups={store.terminalState.terminalGroups}
      activeTerminalGroupId={store.terminalState.activeTerminalGroupId}
      focusRequestId={c.ls.terminalFocusRequestId}
      onSplitTerminal={c.splitTerminal}
      onNewTerminal={c.createNewTerminal}
      splitShortcutLabel={c.cd.splitTerminalShortcutLabel ?? undefined}
      newShortcutLabel={c.cd.newTerminalShortcutLabel ?? undefined}
      closeShortcutLabel={c.cd.closeTerminalShortcutLabel ?? undefined}
      onActiveTerminalChange={c.activateTerminal}
      onCloseTerminal={c.closeTerminal}
      onHeightChange={c.setTerminalHeight}
      onAddTerminalContext={c.addTerminalContextToDraft}
    />
  )
}

export function ChatViewInner() {
  const c = useChatViewCtx()
  if (!c.td.activeThread) return null
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      <ChatViewHeaderPanel />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatViewMessagesPane />
          <ChatViewComposerForm />
          <ChatViewBranchToolbarBlock />
          <ChatViewPullRequestDialogBlock />
        </div>
        <ChatViewPlanSidebarBlock />
        <ChatViewAuxSidebarBlock />
      </div>
      <ChatViewTerminalDrawerBlock />
      <ChatViewImageOverlayCtx />
    </div>
  )
}
