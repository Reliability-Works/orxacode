import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, RefreshCwIcon, RotateCwIcon, SettingsIcon, XIcon } from 'lucide-react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { cn } from '~/lib/utils'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { RemoteAccessControl } from '../RemoteAccessControl'
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
  onClick: (anchor?: HTMLElement | null) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={buttonRef}
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
              onClick(buttonRef.current)
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
  onClick: (anchor?: HTMLElement | null) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)

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
            ref={buttonRef}
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
              onClick(buttonRef.current)
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

function SidebarUpdateCard({
  state,
  onAction,
  onDismiss,
}: {
  state: DesktopUpdateState
  onAction: () => void
  onDismiss: () => void
}) {
  const action = resolveDesktopUpdateButtonAction(state)
  const isDownloading = state.status === 'downloading'
  const isDownloaded = action === 'install'
  const version = state.downloadedVersion ?? state.availableVersion

  let label: string
  let description: string
  let icon: React.ReactNode

  if (isDownloaded) {
    label = 'Restart to update'
    description = `v${version} is ready to install`
    icon = <RotateCwIcon className="size-3.5" />
  } else if (isDownloading) {
    const pct = typeof state.downloadPercent === 'number' ? Math.floor(state.downloadPercent) : null
    label = pct !== null ? `Downloading… ${pct}%` : 'Downloading…'
    description = `v${version}`
    icon = <DownloadIcon className="size-3.5 animate-pulse" />
  } else {
    label = 'Download update'
    description = `v${version} available`
    icon = <DownloadIcon className="size-3.5" />
  }

  return (
    <div className="mx-1 mb-1 rounded-lg border border-border/60 bg-card/80 px-3 py-2">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{label}</p>
          <p className="text-caption text-muted-foreground">{description}</p>
        </div>
        {!isDownloading && (
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
            aria-label="Dismiss"
            onClick={e => {
              e.stopPropagation()
              onDismiss()
            }}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>
      {isDownloading && typeof state.downloadPercent === 'number' && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/40 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, state.downloadPercent))}%` }}
          />
        </div>
      )}
      {!isDownloading && (
        <button
          type="button"
          className="mt-2 w-full rounded-md bg-foreground/10 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/15"
          onClick={onAction}
        >
          {isDownloaded ? 'Restart now' : 'Download'}
        </button>
      )}
    </div>
  )
}

function shouldShowUpdateCard(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false
  const action = resolveDesktopUpdateButtonAction(state)
  return action === 'download' || action === 'install' || state.status === 'downloading'
}

export function SidebarMainFooter({
  desktopUpdateState,
  onNavigateToSettings,
  onUpdateAction,
}: {
  desktopUpdateState: DesktopUpdateState | null
  onNavigateToSettings: () => void
  onUpdateAction: (anchor?: HTMLElement | null) => void
}) {
  const [updateCardDismissed, setUpdateCardDismissed] = useState(false)
  const showCard = isElectron && !updateCardDismissed && shouldShowUpdateCard(desktopUpdateState)

  // Reset dismissed state when update status transitions to a new actionable state
  const currentStatus = desktopUpdateState?.status
  useEffect(() => {
    if (currentStatus === 'available' || currentStatus === 'downloaded') {
      setUpdateCardDismissed(false)
    }
  }, [currentStatus])

  return (
    <SidebarFooter className="p-2">
      {showCard && desktopUpdateState && (
        <SidebarUpdateCard
          state={desktopUpdateState}
          onAction={() => onUpdateAction()}
          onDismiss={() => setUpdateCardDismissed(true)}
        />
      )}
      <div className="flex items-center gap-1">
        {isElectron ? (
          <SidebarUpdateFooterButton state={desktopUpdateState} onClick={onUpdateAction} />
        ) : null}
        {isElectron ? (
          <RemoteAccessControl buttonClassName="size-8" iconClassName="size-3.5" />
        ) : null}
        <SidebarFooterIconButton ariaLabel="Settings" onClick={() => void onNavigateToSettings()}>
          <SettingsIcon className="size-3.5" />
        </SidebarFooterIconButton>
      </div>
    </SidebarFooter>
  )
}
