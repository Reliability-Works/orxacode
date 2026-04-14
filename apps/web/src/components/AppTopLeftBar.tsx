/**
 * AppTopLeftBar — persistent top-left bar containing the sidebar toggle.
 * Fixed position so it remains visible regardless of sidebar collapsed/
 * expanded state; collapsed-route headers reserve this exact width so content
 * never slides underneath the traffic lights or trigger.
 */

import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from '../branding'
import { isElectron } from '../env'
import { useIsMobile } from '../hooks/useMediaQuery'
import { cn } from '~/lib/utils'
import { SidebarTrigger } from './ui/sidebar'

export const APP_TOP_LEFT_BAR_WIDTH = '272px'

export function AppTopLeftBar() {
  const isMobile = useIsMobile()
  if (isMobile) return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-y-0 start-0 top-0 z-50 flex h-[52px] items-center gap-2',
        isElectron ? 'drag-region ps-[98px] pe-3 pt-[5px]' : 'px-3'
      )}
      style={{ width: APP_TOP_LEFT_BAR_WIDTH }}
      data-slot="app-top-left-bar"
    >
      <SidebarTrigger className="pointer-events-auto size-7 shrink-0" />
      <div
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1 cursor-default"
        title={`Version ${APP_VERSION}`}
      >
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          {APP_BASE_NAME}
        </span>
        {APP_STAGE_LABEL ? (
          <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wider text-muted-foreground/60">
            {APP_STAGE_LABEL}
          </span>
        ) : null}
      </div>
    </div>
  )
}
