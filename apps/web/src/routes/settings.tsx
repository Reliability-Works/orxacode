import { RotateCcwIcon } from 'lucide-react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { useSettingsRestore } from '../components/settings/useSettingsRestore'
import { APP_TOP_LEFT_BAR_WIDTH } from '../components/AppTopLeftBar'
import { Button } from '../components/ui/button'
import { SidebarInset } from '../components/ui/sidebar'
import { useSidebar } from '../components/ui/sidebar.shared'
import { isElectron } from '../env'
import { cn } from '~/lib/utils'

function RestoreDefaultsButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <div className="ms-auto flex items-center gap-2">
      <Button size="xs" variant="outline" disabled={disabled} onClick={onClick}>
        <RotateCcwIcon className="size-3.5" />
        Restore defaults
      </Button>
    </div>
  )
}

function SettingsHeader({
  collapsed,
  changedSettingLabels,
  restoreDefaults,
}: {
  collapsed: boolean
  changedSettingLabels: readonly string[]
  restoreDefaults: () => Promise<void> | void
}) {
  const onRestore = () => void restoreDefaults()
  const disabled = changedSettingLabels.length === 0
  if (isElectron) {
    return (
      <div
        className={cn(
          'drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5'
        )}
        style={collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined}
      >
        <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Settings</span>
        <RestoreDefaultsButton disabled={disabled} onClick={onRestore} />
      </div>
    )
  }
  return (
    <header
      className={cn('border-b border-border px-3 py-2 sm:px-5')}
      style={collapsed ? { paddingInlineStart: APP_TOP_LEFT_BAR_WIDTH } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Settings</span>
        <RestoreDefaultsButton disabled={disabled} onClick={onRestore} />
      </div>
    </header>
  )
}

function useEscapeToGoBack() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        window.history.back()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

function SettingsContentLayout() {
  const [restoreSignal, setRestoreSignal] = useState(0)
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(() =>
    setRestoreSignal(value => value + 1)
  )
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  useEscapeToGoBack()

  return (
    <SidebarInset className="h-full min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <SettingsHeader
          collapsed={collapsed}
          changedSettingLabels={changedSettingLabels}
          restoreDefaults={restoreDefaults}
        />
        <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarInset>
  )
}

function SettingsRouteLayout() {
  return <SettingsContentLayout />
}

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings') {
      throw redirect({ to: '/settings/general', replace: true })
    }
  },
  component: SettingsRouteLayout,
})
