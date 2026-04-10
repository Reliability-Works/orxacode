import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type React from 'react'
import type { DesktopUpdateReleaseChannel, DesktopUpdateState } from '@orxa-code/contracts'
import { APP_VERSION } from '../../branding'
import {
  beginDesktopUpdateCheckState,
  canAttemptDesktopUpdateCheck,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from '../../components/desktopUpdate.logic'
import {
  setDesktopUpdatePreferencesQueryData,
  setDesktopUpdateStateQueryData,
  useDesktopUpdatePreferences,
  useDesktopUpdateState,
} from '../../lib/desktopUpdateReactQuery'
import { Button } from '../ui/button'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/select'
import { toastManager } from '../ui/toastState'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { SettingResetButton } from './settingsLayout'

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
  status?: React.ReactNode
  resetAction?: React.ReactNode
  control?: React.ReactNode
}

const UPDATE_CHANNEL_LABELS: Record<DesktopUpdateReleaseChannel, string> = {
  stable: 'Stable',
  prerelease: 'Pre-release',
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
  queryClient: ReturnType<typeof useQueryClient>,
  updateState: DesktopUpdateState | null,
  setManualCheckInFlight: React.Dispatch<React.SetStateAction<boolean>>
) {
  if (typeof bridge.checkForUpdate !== 'function') return
  setManualCheckInFlight(true)
  setDesktopUpdateStateQueryData(queryClient, beginDesktopUpdateCheckState(updateState))
  void bridge
    .checkForUpdate()
    .then(result => {
      setDesktopUpdateStateQueryData(queryClient, result.state)
      if (result.checked && result.state.status === 'up-to-date') {
        toastManager.add({
          type: 'success',
          title: "You're up to date",
          description: `${result.state.currentVersion} is currently the newest version available.`,
        })
        return
      }
      if (!result.checked) {
        toastManager.add({
          type: 'warning',
          title: 'Updates unavailable',
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
    .finally(() => {
      setManualCheckInFlight(false)
    })
}

export function AboutVersionRow({
  SettingsRowComponent,
}: {
  SettingsRowComponent: React.ComponentType<SettingsRowMinimal>
}) {
  const queryClient = useQueryClient()
  const updateStateQuery = useDesktopUpdateState()
  const [manualCheckInFlight, setManualCheckInFlight] = useState(false)
  const updateState = updateStateQuery.data ?? null
  const visibleUpdateState =
    manualCheckInFlight && updateState ? beginDesktopUpdateCheckState(updateState) : updateState
  const action = resolveUpdateButtonAction(visibleUpdateState)
  const bridge = window.desktopBridge
  const canManualCheck = canAttemptDesktopUpdateCheck(
    visibleUpdateState,
    typeof bridge?.checkForUpdate === 'function'
  )

  const handleButtonClick = useCallback(() => {
    if (!bridge) return
    if (action === 'download') {
      runDownloadUpdate(bridge, queryClient)
      return
    }
    if (action === 'install') {
      runInstallUpdate(bridge, queryClient, visibleUpdateState)
      return
    }
    runCheckForUpdate(bridge, queryClient, visibleUpdateState, setManualCheckInFlight)
  }, [action, bridge, queryClient, visibleUpdateState])

  const buttonTooltip = visibleUpdateState
    ? getDesktopUpdateButtonTooltip(visibleUpdateState)
    : null
  const buttonDisabled =
    manualCheckInFlight ||
    (action === 'none' ? !canManualCheck : isDesktopUpdateButtonDisabled(visibleUpdateState))
  const buttonLabel = buildUpdateButtonLabel(action, visibleUpdateState)
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

export function DesktopUpdateChannelRow({
  SettingsRowComponent,
}: {
  SettingsRowComponent: React.ComponentType<SettingsRowMinimal>
}) {
  const queryClient = useQueryClient()
  const preferencesQuery = useDesktopUpdatePreferences()
  const preferences = preferencesQuery.data ?? null
  const bridge = window.desktopBridge
  const currentChannel = preferences?.releaseChannel ?? 'stable'

  const handleValueChange = useCallback(
    (value: DesktopUpdateReleaseChannel | null) => {
      if (!bridge || (value !== 'stable' && value !== 'prerelease')) return
      void bridge
        .setUpdatePreferences({ releaseChannel: value })
        .then(nextPreferences => {
          setDesktopUpdatePreferencesQueryData(queryClient, nextPreferences)
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: 'error',
            title: 'Could not update release channel',
            description:
              error instanceof Error ? error.message : 'Saving update preferences failed.',
          })
        })
    },
    [bridge, queryClient]
  )

  return (
    <SettingsRowComponent
      title="Release channel"
      description="Stable tracks production releases. Pre-release includes beta builds on the next update check."
      resetAction={
        currentChannel !== 'stable' ? (
          <SettingResetButton label="release channel" onClick={() => handleValueChange('stable')} />
        ) : null
      }
      status="Channel changes apply the next time you check for updates."
      control={
        <Select value={currentChannel} onValueChange={handleValueChange}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Desktop update release channel">
            <SelectValue>{UPDATE_CHANNEL_LABELS[currentChannel]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="stable">
              {UPDATE_CHANNEL_LABELS.stable}
            </SelectItem>
            <SelectItem hideIndicator value="prerelease">
              {UPDATE_CHANNEL_LABELS.prerelease}
            </SelectItem>
          </SelectPopup>
        </Select>
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
