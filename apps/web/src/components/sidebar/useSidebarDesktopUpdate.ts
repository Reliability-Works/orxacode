/**
 * useSidebarDesktopUpdate — desktop update state subscription and click handler.
 */

import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { toastManager } from '../ui/toastState'
import {
  beginDesktopUpdateCheckState,
  canAttemptDesktopUpdateCheck,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  getArm64IntelBuildWarningDescription,
  shouldToastDesktopUpdateActionResult,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
} from '../desktopUpdate.logic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarDesktopUpdateReturn {
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonDisabled: boolean
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  showArm64IntelBuildWarning: boolean
  arm64IntelBuildWarningDescription: string | null
  handleDesktopUpdateButtonClick: () => void
}

// ---------------------------------------------------------------------------
// Click handler (extracted to reduce hook body line count)
// ---------------------------------------------------------------------------

function runDesktopUpdateCheck(input: {
  bridge: NonNullable<typeof window.desktopBridge>
  desktopUpdateState: DesktopUpdateState | null
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  setManualCheckInFlight: React.Dispatch<React.SetStateAction<boolean>>
}) {
  if (
    !canAttemptDesktopUpdateCheck(
      input.desktopUpdateState,
      typeof input.bridge.checkForUpdate === 'function'
    )
  ) {
    return
  }
  input.setManualCheckInFlight(true)
  input.setDesktopUpdateState(current => beginDesktopUpdateCheckState(current))
  void input.bridge
    .checkForUpdate()
    .then(result => {
      input.setDesktopUpdateState(result.state)
      if (result.checked) {
        if (result.state.status === 'up-to-date') {
          toastManager.add({
            type: 'success',
            title: "You're up to date",
            description: `${result.state.currentVersion} is currently the newest version available.`,
          })
        }
        return
      }
      toastManager.add({
        type: 'warning',
        title: 'Updates unavailable',
        description: result.state.message ?? 'Automatic updates are not available in this build.',
      })
    })
    .catch(error =>
      toastManager.add({
        type: 'error',
        title: 'Could not check for updates',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      })
    )
    .finally(() => {
      input.setManualCheckInFlight(false)
    })
}

function execDesktopUpdateClick(opts: {
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonDisabled: boolean
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  setManualCheckInFlight: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const {
    desktopUpdateState,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    setDesktopUpdateState,
    setManualCheckInFlight,
  } = opts
  const bridge = window.desktopBridge
  if (!bridge) return
  if (desktopUpdateButtonDisabled) return

  if (desktopUpdateButtonAction === 'download' && desktopUpdateState) {
    void bridge
      .downloadUpdate()
      .then(result => {
        setDesktopUpdateState(result.state)
        if (result.completed) {
          toastManager.add({
            type: 'success',
            title: 'Update downloaded',
            description: 'Restart the app from the update button to install it.',
          })
        }
        if (!shouldToastDesktopUpdateActionResult(result)) return
        const err = getDesktopUpdateActionError(result)
        if (!err) return
        toastManager.add({ type: 'error', title: 'Could not download update', description: err })
      })
      .catch(error =>
        toastManager.add({
          type: 'error',
          title: 'Could not start update download',
          description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        })
      )
    return
  }

  if (desktopUpdateButtonAction === 'install' && desktopUpdateState) {
    const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(desktopUpdateState))
    if (!confirmed) return
    void bridge
      .installUpdate()
      .then(result => {
        setDesktopUpdateState(result.state)
        if (!shouldToastDesktopUpdateActionResult(result)) return
        const err = getDesktopUpdateActionError(result)
        if (!err) return
        toastManager.add({ type: 'error', title: 'Could not install update', description: err })
      })
      .catch(error =>
        toastManager.add({
          type: 'error',
          title: 'Could not install update',
          description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        })
      )
    return
  }

  runDesktopUpdateCheck({
    bridge,
    desktopUpdateState,
    setDesktopUpdateState,
    setManualCheckInFlight,
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarDesktopUpdate(): SidebarDesktopUpdateReturn {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null)
  const [manualCheckInFlight, setManualCheckInFlight] = useState(false)

  useEffect(() => {
    if (!isElectron) return
    const bridge = window.desktopBridge
    if (
      !bridge ||
      typeof bridge.getUpdateState !== 'function' ||
      typeof bridge.onUpdateState !== 'function'
    )
      return
    let disposed = false
    let receivedSubscriptionUpdate = false
    const unsubscribe = bridge.onUpdateState(nextState => {
      if (disposed) return
      receivedSubscriptionUpdate = true
      setDesktopUpdateState(nextState)
    })
    void bridge
      .getUpdateState()
      .then(nextState => {
        if (disposed || receivedSubscriptionUpdate) return
        setDesktopUpdateState(nextState)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const visibleDesktopUpdateState =
    manualCheckInFlight && desktopUpdateState
      ? beginDesktopUpdateCheckState(desktopUpdateState)
      : desktopUpdateState
  const desktopUpdateButtonDisabled =
    manualCheckInFlight || isDesktopUpdateButtonDisabled(visibleDesktopUpdateState)
  const desktopUpdateButtonAction = visibleDesktopUpdateState
    ? resolveDesktopUpdateButtonAction(visibleDesktopUpdateState)
    : 'none'
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(visibleDesktopUpdateState)
  const arm64IntelBuildWarningDescription =
    visibleDesktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(visibleDesktopUpdateState)
      : null

  function handleDesktopUpdateButtonClick() {
    execDesktopUpdateClick({
      desktopUpdateState: visibleDesktopUpdateState,
      desktopUpdateButtonDisabled,
      desktopUpdateButtonAction,
      setDesktopUpdateState,
      setManualCheckInFlight,
    })
  }

  return {
    desktopUpdateState: visibleDesktopUpdateState,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    handleDesktopUpdateButtonClick,
  }
}
