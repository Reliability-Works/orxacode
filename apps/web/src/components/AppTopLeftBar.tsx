/**
 * AppTopLeftBar — persistent top-left bar containing the sidebar toggle and
 * app wordmark. Fixed position so it remains visible regardless of sidebar
 * collapsed/expanded state; its width matches SIDEBAR_WIDTH so the inset
 * headers only need to add `peer-data-[state=collapsed]:ps-[var(--sidebar-width)]`
 * to avoid content slipping underneath it.
 */

import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from '../branding'
import { isElectron } from '../env'
import { cn } from '~/lib/utils'
import { AppBrandMark } from './SidebarBody'
import { SidebarTrigger } from './ui/sidebar'
export function AppTopLeftBar() {
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-y-0 start-0 top-0 z-50 flex h-[52px] w-[var(--sidebar-width)] items-center gap-2',
        isElectron ? 'drag-region ps-[90px] pe-3' : 'px-3'
      )}
      data-slot="app-top-left-bar"
    >
      <SidebarTrigger className="pointer-events-auto size-7 shrink-0" />
      <div
        className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1 cursor-default"
        title={`Version ${APP_VERSION}`}
      >
        <AppBrandMark />
        <span className="ms-1 truncate text-sm font-medium tracking-tight text-muted-foreground">
          {APP_BASE_NAME}
        </span>
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </div>
  )
}
