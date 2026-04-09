/**
 * ChatView header + status/error banners panel.
 *
 * Extracted from ChatView.tsx to satisfy max-lines and keep the root shell thin.
 */

import { useMemo } from 'react'
import { cn } from '~/lib/utils'
import { isElectron } from '../../env'
import { ChatHeader } from './ChatHeader'
import { ProviderStatusBanner } from './ProviderStatusBanner'
import { ThreadErrorBanner } from './ThreadErrorBanner'
import { useChatViewCtx } from './ChatViewContext'
import { useSidebar } from '../ui/sidebar.shared'
import { useChatSplitPaneContext } from './ChatSplitPaneContext'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Columns2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
} from 'lucide-react'
import { ThreadHandoffMenu } from './ThreadHandoffMenu'

function HandoffMenuAction() {
  const c = useChatViewCtx()
  if (!c.td.activeThread) return null
  return (
    <ThreadHandoffMenu
      thread={c.td.activeThread}
      project={c.td.activeProject ?? null}
      {...(c.td.canCheckoutPullRequestIntoThread
        ? { onOpenPullRequestDialog: c.openPullRequestDialog }
        : {})}
    />
  )
}

function ChatHeaderSplitActions() {
  const split = useChatSplitPaneContext()
  const c = useChatViewCtx()
  if (!c.td.activeThread) return null
  if (!split || !split.splitOpen) {
    if (split) {
      return (
        <div className="flex items-center gap-1.5">
          <HandoffMenuAction />
          <Button
            size="xs"
            variant="outline"
            onClick={split.toggleSplit}
            aria-label="Open split view"
          >
            <Columns2Icon className="size-3.5" />
          </Button>
        </div>
      )
    }
    return <HandoffMenuAction />
  }

  const closeIcon = split.pane === 'primary' ? PanelRightCloseIcon : PanelLeftCloseIcon
  const CloseIcon = closeIcon
  return (
    <div className="flex items-center gap-1.5">
      <HandoffMenuAction />
      <Button
        size="xs"
        variant={split.focusedPane === split.pane ? 'secondary' : 'outline'}
        onClick={split.focusPane}
        aria-label={`Focus ${split.pane} pane`}
      >
        <Columns2Icon className="size-3.5" />
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={split.toggleMaximize}
        aria-label={
          split.maximizedPane === split.pane
            ? `Restore ${split.pane} pane`
            : `Maximize ${split.pane} pane`
        }
      >
        {split.maximizedPane === split.pane ? (
          <Minimize2Icon className="size-3.5" />
        ) : (
          <Maximize2Icon className="size-3.5" />
        )}
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={split.toggleSplit}
        aria-label={split.splitOpen ? 'Close split view' : 'Open split view'}
      >
        <CloseIcon className="size-3.5" />
      </Button>
    </div>
  )
}

export function ChatViewHeaderPanel() {
  const c = useChatViewCtx()
  const { td, store, cd, gitCwd, setThreadError } = c
  const { activeThread, activeProject, activeProviderStatus } = td
  const { keybindings, availableEditors, terminalState } = store
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const diffData = c.panelDiffQuery.data
  const diffStats = useMemo(() => {
    if (!diffData) return null
    const files = [...diffData.staged, ...diffData.unstaged]
    const additions = files.reduce((s, f) => s + f.additions, 0)
    const deletions = files.reduce((s, f) => s + f.deletions, 0)
    return { additions, deletions }
  }, [diffData])
  if (!activeThread) return null
  const lastInvokedScriptId = activeProject
    ? (c.ls.lastInvokedScriptByProjectId[activeProject.id] ?? null)
    : null
  return (
    <>
      <header
        className={cn(
          'border-b border-border px-3 sm:px-5',
          isElectron ? 'drag-region flex h-[52px] items-center' : 'py-2 sm:py-3',
          collapsed && 'ps-[var(--sidebar-width)]'
        )}
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
          extraActions={<ChatHeaderSplitActions />}
        />
      </header>
      {activeThread.handoff ? (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-2 sm:px-5">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            Handoff
          </Badge>
          <p className="truncate text-xs text-muted-foreground">
            From {activeThread.handoff.sourceProvider} to {activeThread.handoff.targetProvider} via{' '}
            {activeThread.handoff.sourceThreadTitle}
          </p>
        </div>
      ) : null}
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
    </>
  )
}
