import { isElectron } from '../../env'
import { cn } from '~/lib/utils'
import { useSidebar } from '../ui/sidebar.shared'

export function ChatViewEmptyState() {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      {!isElectron && (
        <header
          className={cn(
            'border-b border-border px-3 py-2',
            collapsed && 'ps-[var(--sidebar-width)]'
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}
      {isElectron && (
        <div
          className={cn(
            'drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-5',
            collapsed && 'ps-[var(--sidebar-width)]'
          )}
        >
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  )
}
