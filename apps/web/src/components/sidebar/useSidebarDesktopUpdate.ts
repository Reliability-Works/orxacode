/**
 * useSidebarDesktopUpdate — desktop update state subscription and click handler.
 */

import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { toastManager } from '../ui/toastState'
import {
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
}) {
  if (
    !canAttemptDesktopUpdateCheck(
      input.desktopUpdateState,
      typeof input.bridge.checkForUpdate === 'function'
    )
  ) {
    return
  }
  void input.bridge
    .checkForUpdate()
    .then(result => {
      input.setDesktopUpdateState(result.state)
      if (result.checked) return
      toastManager.add({
        type: 'error',
        title: 'Could not check for updates',
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
}

function execDesktopUpdateClick(opts: {
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonDisabled: boolean
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
}) {
  const {
    desktopUpdateState,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    setDesktopUpdateState,
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

  runDesktopUpdateCheck({ bridge, desktopUpdateState, setDesktopUpdateState })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarDesktopUpdate(): SidebarDesktopUpdateReturn {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null)

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

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState)
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : 'none'
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState)
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null

  function handleDesktopUpdateButtonClick() {
    execDesktopUpdateClick({
      desktopUpdateState,
      desktopUpdateButtonDisabled,
      desktopUpdateButtonAction,
      setDesktopUpdateState,
    })
  }

  return {
    desktopUpdateState,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    handleDesktopUpdateButtonClick,
  }
}
