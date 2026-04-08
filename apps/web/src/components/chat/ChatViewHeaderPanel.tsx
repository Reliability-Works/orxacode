/**
 * ChatView header + status/error banners panel.
 *
 * Extracted from ChatView.tsx to satisfy max-lines and keep the root shell thin.
 */

import { cn } from '~/lib/utils'
import { isElectron } from '../../env'
import { ChatHeader } from './ChatHeader'
import { ProviderStatusBanner } from './ProviderStatusBanner'
import { ThreadErrorBanner } from './ThreadErrorBanner'
import { useChatViewCtx } from './ChatViewContext'

export function ChatViewHeaderPanel() {
  const c = useChatViewCtx()
  const { td, store, cd, gitCwd, setThreadError } = c
  const { activeThread, activeProject, activeProviderStatus, diffOpen } = td
  const { keybindings, availableEditors, terminalState } = store
  if (!activeThread) return null
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
          diffToggleShortcutLabel={cd.diffPanelShortcutLabel}
          gitCwd={gitCwd}
          diffOpen={diffOpen}
          onRunProjectScript={script => {
            void c.runProjectScript(script)
          }}
          onAddProjectScript={c.saveProjectScript}
          onUpdateProjectScript={c.updateProjectScript}
          onDeleteProjectScript={c.deleteProjectScript}
          onToggleTerminal={c.toggleTerminalVisibility}
          onToggleDiff={c.onToggleDiff}
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
