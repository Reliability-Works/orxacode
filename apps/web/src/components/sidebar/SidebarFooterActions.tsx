import type React from 'react'
import { DownloadIcon, RefreshCwIcon, RotateCwIcon, SettingsIcon } from 'lucide-react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { cn } from '~/lib/utils'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { SidebarFooter } from '../ui/sidebar'
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  resolveDesktopUpdateButtonAction,
} from '../desktopUpdate.logic'

function SidebarFooterIconButton({
  ariaLabel,
  children,
  disabled = false,
  isActive = false,
  onClick,
}: {
  ariaLabel: string
  children: React.ReactNode
  disabled?: boolean
  isActive?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground',
              isActive && 'bg-accent text-foreground',
              disabled && 'cursor-default opacity-60'
            )}
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (disabled) return
              onClick()
            }}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup side="top">{ariaLabel}</TooltipPopup>
    </Tooltip>
  )
}

function SidebarUpdateFooterButton({
  state,
  onClick,
}: {
  state: DesktopUpdateState | null
  onClick: () => void
}) {
  if (!isElectron || !state || !state.enabled) {
    return (
      <SidebarFooterIconButton ariaLabel="Check for updates" onClick={onClick}>
        <RefreshCwIcon className="size-3.5" />
      </SidebarFooterIconButton>
    )
  }

  const action = resolveDesktopUpdateButtonAction(state)
  const isCheckAction = action === 'none' && canCheckForUpdate(state)
  const label = isCheckAction
    ? 'Check for updates'
    : action === 'install'
      ? 'Install update'
      : action === 'download'
        ? 'Download update'
        : 'Updates unavailable'
  const tooltip = action === 'none' && isCheckAction ? label : getDesktopUpdateButtonTooltip(state)
  const isBusy = state.status === 'checking' || state.status === 'downloading'
  const icon =
    state.status === 'checking' ? (
      <RefreshCwIcon className="size-3.5 animate-spin" />
    ) : action === 'install' ? (
      <RotateCwIcon className="size-3.5" />
    ) : action === 'download' || state.status === 'downloading' ? (
      <DownloadIcon className="size-3.5" />
    ) : (
      <RefreshCwIcon className="size-3.5" />
    )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              'relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground',
              (action === 'download' || action === 'install') && 'bg-accent text-foreground',
              isBusy && 'cursor-default opacity-60'
            )}
            aria-label={label}
            aria-disabled={isBusy || undefined}
            onClick={() => {
              if (isBusy) return
              onClick()
            }}
          >
            {icon}
          </button>
        }
      />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  )
}

export function SidebarMainFooter({
  desktopUpdateState,
  onNavigateToSettings,
  onUpdateAction,
}: {
  desktopUpdateState: DesktopUpdateState | null
  onNavigateToSettings: () => void
  onUpdateAction: () => void
}) {
  return (
    <SidebarFooter className="p-2">
      <div className="flex items-center gap-1">
        {isElectron ? (
          <SidebarUpdateFooterButton state={desktopUpdateState} onClick={onUpdateAction} />
        ) : null}
        <SidebarFooterIconButton ariaLabel="Settings" onClick={() => void onNavigateToSettings()}>
          <SettingsIcon className="size-3.5" />
        </SidebarFooterIconButton>
      </div>
    </SidebarFooter>
  )
}
