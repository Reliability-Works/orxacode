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
        />
      </header>
      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
    </>
  )
}
