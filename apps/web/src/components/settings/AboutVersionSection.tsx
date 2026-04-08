import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type React from 'react'
import { APP_VERSION } from '../../branding'
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from '../../components/desktopUpdate.logic'
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from '../../lib/desktopUpdateReactQuery'
import { Button } from '../ui/button'
import { toastManager } from '../ui/toastState'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  )
}

interface SettingsRowMinimal {
  title: React.ReactNode
  description: string
  control?: React.ReactNode
}

function resolveUpdateButtonAction(
  updateState: Parameters<typeof resolveDesktopUpdateButtonAction>[0] | null
) {
  return updateState ? resolveDesktopUpdateButtonAction(updateState) : 'none'
}

function buildUpdateButtonLabel(action: string, updateState: { status?: string } | null): string {
  const actionLabel: Record<string, string> = { download: 'Download', install: 'Install' }
  const statusLabel: Record<string, string> = {
    checking: 'Checking…',
    downloading: 'Downloading…',
    'up-to-date': 'Up to Date',
  }
  return actionLabel[action] ?? statusLabel[updateState?.status ?? ''] ?? 'Check for Updates'
}

function runDownloadUpdate(
  bridge: NonNullable<typeof window.desktopBridge>,
  queryClient: ReturnType<typeof useQueryClient>
) {
  void bridge
    .downloadUpdate()
    .then(result => setDesktopUpdateStateQueryData(queryClient, result.state))
    .catch((error: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Could not download update',
        description: error instanceof Error ? error.message : 'Download failed.',
      })
    })
}

function runInstallUpdate(
  bridge: NonNullable<typeof window.desktopBridge>,
  queryClient: ReturnType<typeof useQueryClient>,
  updateState: { availableVersion: string | null; downloadedVersion: string | null } | null
) {
  const confirmed = window.confirm(
    getDesktopUpdateInstallConfirmationMessage(
      updateState ?? { availableVersion: null, downloadedVersion: null }
    )
  )
  if (!confirmed) return
  void bridge
    .installUpdate()
    .then(result => setDesktopUpdateStateQueryData(queryClient, result.state))
    .catch((error: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Could not install update',
        description: error instanceof Error ? error.message : 'Install failed.',
      })
    })
}

function runCheckForUpdate(
  bridge: NonNullable<typeof window.desktopBridge>,
  queryClient: ReturnType<typeof useQueryClient>
) {
  if (typeof bridge.checkForUpdate !== 'function') return
  void bridge
    .checkForUpdate()
    .then(result => {
      setDesktopUpdateStateQueryData(queryClient, result.state)
      if (!result.checked) {
        toastManager.add({
          type: 'error',
          title: 'Could not check for updates',
          description: result.state.message ?? 'Automatic updates are not available in this build.',
        })
      }
    })
    .catch((error: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Could not check for updates',
        description: error instanceof Error ? error.message : 'Update check failed.',
      })
    })
}

export function AboutVersionRow({
  SettingsRowComponent,
}: {
  SettingsRowComponent: React.ComponentType<SettingsRowMinimal>
}) {
  const queryClient = useQueryClient()
  const updateStateQuery = useDesktopUpdateState()
  const updateState = updateStateQuery.data ?? null
  const action = resolveUpdateButtonAction(updateState)

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge
    if (!bridge) return
    if (action === 'download') {
      runDownloadUpdate(bridge, queryClient)
      return
    }
    if (action === 'install') {
      runInstallUpdate(bridge, queryClient, updateState)
      return
    }
    runCheckForUpdate(bridge, queryClient)
  }, [action, queryClient, updateState])

  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null
  const buttonDisabled =
    action === 'none' ? !canCheckForUpdate(updateState) : isDesktopUpdateButtonDisabled(updateState)
  const buttonLabel = buildUpdateButtonLabel(action, updateState)
  const description =
    action === 'download' || action === 'install'
      ? 'Update available.'
      : 'Current version of the application.'

  return (
    <SettingsRowComponent
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant={action === 'install' ? 'default' : 'outline'}
                disabled={buttonDisabled}
                onClick={handleButtonClick}
              >
                {buttonLabel}
              </Button>
            }
          />
          {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
        </Tooltip>
      }
    />
  )
}

export function StaticAboutVersionRow({
  SettingsRowComponent,
}: {
  SettingsRowComponent: React.ComponentType<SettingsRowMinimal>
}) {
  return (
    <SettingsRowComponent
      title={<AboutVersionTitle />}
      description="Current version of the application."
    />
  )
}
