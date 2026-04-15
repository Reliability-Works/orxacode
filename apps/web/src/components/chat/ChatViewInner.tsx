/**
 * ChatView inner layout — composes header, messages pane, composer, sidebars.
 *
 * Extracted from ChatView.tsx. Split into small sub-components so the root
 * layout stays under max-lines-per-function.
 */

import { useQuery } from '@tanstack/react-query'
import { cn } from '~/lib/utils'
import { gitDiscoverReposQueryOptions } from '~/lib/gitReactQuery'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useZenMode } from '../../hooks/useZenMode'
import BranchToolbar from '../BranchToolbar'
import { FilesSidebar } from '../files-sidebar/FilesSidebar'
import ThreadTerminalDrawer from '../ThreadTerminalDrawer'
import { PullRequestThreadDialog } from '../PullRequestThreadDialog'
import { GitSidebar } from '../git-sidebar/GitSidebar'
import { BrowserSidebar } from '../browser-sidebar/BrowserSidebar'
import { Sheet, SheetPopup } from '../ui/sheet'
import { ChatViewHeaderPanel } from './ChatViewHeaderPanel'
import { ChatViewSecondaryHeaderPanel } from './ChatViewSecondaryHeaderPanel'
import { useChatSplitPaneContext } from './ChatSplitPaneContext'
import { ChatViewMessagesPane } from './ChatViewMessagesPane'
import { ChatViewComposerBody } from './ChatViewComposerBody'
import { ChatViewImageOverlayCtx } from './ChatViewImageOverlayCtx'
import { useChatViewCtx } from './ChatViewContext'
import { useChatAuxSidebarResize } from './ChatViewAuxSidebar.resize'

function ChatViewComposerForm() {
  const c = useChatViewCtx()
  const { composerFormRef } = c.scroll.refs
  const projectCwd = c.td.activeProject?.cwd ?? null
  const discoverQuery = useQuery(gitDiscoverReposQueryOptions(projectCwd))
  const hasDiscoveredRepos = (discoverQuery.data?.repos.length ?? 0) >= 2
  const showBranchToolbar = c.cd.isGitRepo || hasDiscoveredRepos
  if (c.td.isSubagentThread) return null
  return (
    <div className={cn('px-3 pt-1.5 sm:px-5 sm:pt-2', showBranchToolbar ? 'pb-1' : 'pb-3 sm:pb-4')}>
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
  const projectCwd = td.activeProject?.cwd ?? null
  const discoverQuery = useQuery(gitDiscoverReposQueryOptions(projectCwd))
  const hasDiscoveredRepos = (discoverQuery.data?.repos.length ?? 0) >= 2
  if (!td.activeThread || (!c.cd.isGitRepo && !hasDiscoveredRepos) || td.isSubagentThread)
    return null
  return (
    <BranchToolbar
      threadId={td.activeThread.id}
      onEnvModeChange={c.onEnvModeChange}
      envLocked={false}
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
  const isMobile = useIsMobile()
  const zen = useZenMode()
  const { gitCwd, td } = c
  if (zen.enabled) return null
  if (c.ls.auxSidebarMode === 'none') return null

  let content: React.ReactNode = null

  if (c.ls.auxSidebarMode === 'browser') {
    if (!td.activeProject) return null
    content = <BrowserSidebar onClose={c.closeAuxSidebar} />
  } else {
    if (!gitCwd) return null
    if (c.ls.auxSidebarMode === 'files') {
      content = (
        <FilesSidebar
          cwd={gitCwd}
          onClose={c.closeAuxSidebar}
          onInsertPath={c.insertComposerPathReference}
        />
      )
    } else {
      if (!c.cd.isGitRepo && !c.td.activeThread?.gitRoot) return null
      content = (
        <GitSidebar
          cwd={gitCwd}
          diffQueryResult={c.panelDiffQuery}
          diffScope={c.ls.gitDiffScope}
          onDiffScopeChange={c.ls.setGitDiffScope}
          onClose={c.closeAuxSidebar}
        />
      )
    }
  }

  if (isMobile) {
    return (
      <Sheet
        open
        onOpenChange={open => {
          if (!open) c.closeAuxSidebar()
        }}
      >
        <SheetPopup side="right" showCloseButton={false} className="w-full max-w-none border-s-0">
          <div className="min-h-0 flex-1">{content}</div>
        </SheetPopup>
      </Sheet>
    )
  }

  return <ChatViewAuxSidebarShell>{content}</ChatViewAuxSidebarShell>
}

function ChatViewTerminalDrawerBlock() {
  const c = useChatViewCtx()
  const zen = useZenMode()
  const { store, gitCwd } = c
  const { activeThread, activeProject } = c.td
  if (zen.enabled) return null
  if (c.td.isSubagentThread || !store.terminalState.terminalOpen || !activeProject || !activeThread)
    return null
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

export function ChatViewInner({ showHeader = true }: { showHeader?: boolean }) {
  const c = useChatViewCtx()
  const isMobile = useIsMobile()
  const split = useChatSplitPaneContext()
  const isSecondaryPane = split?.splitOpen === true && split.pane === 'secondary'
  if (!c.td.activeThread) return null
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      {isSecondaryPane ? (
        <ChatViewSecondaryHeaderPanel />
      ) : showHeader ? (
        <ChatViewHeaderPanel />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatViewMessagesPane />
          <ChatViewComposerForm />
          <ChatViewBranchToolbarBlock />
          <ChatViewPullRequestDialogBlock />
        </div>
        {!isMobile ? <ChatViewAuxSidebarBlock /> : null}
      </div>
      {isMobile ? <ChatViewAuxSidebarBlock /> : null}
      <ChatViewTerminalDrawerBlock />
      <ChatViewImageOverlayCtx />
    </div>
  )
}
