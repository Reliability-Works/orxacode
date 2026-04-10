import { Button } from '../ui/button'
import { isElectron } from '../../env'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { cn } from '~/lib/utils'
import { APP_TOP_LEFT_BAR_WIDTH } from '../AppTopLeftBar'
import { useSidebar } from '../ui/sidebar.shared'

export function ChatViewEmptyState() {
  const { state, setOpenMobile } = useSidebar()
  const isMobile = useIsMobile()
  const collapsed = state === 'collapsed'
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      {!isElectron && (
        <header
          className={cn('border-b border-border px-3 py-2')}
          style={
            !isMobile && collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}
      {isElectron && (
        <div
          className={cn(
            'drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-5'
          )}
          style={
            !isMobile && collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined
          }
        >
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
          {isMobile ? (
            <Button className="mt-4" onClick={() => setOpenMobile(true)}>
              Open threads
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
