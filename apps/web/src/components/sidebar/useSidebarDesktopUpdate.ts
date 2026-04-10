/**
 * useSidebarDesktopUpdate — desktop update state subscription and click handler.
 */

import { useEffect, useRef, useState } from 'react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { anchoredToastManager, toastManager } from '../ui/toastState'
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
  handleDesktopUpdateButtonClick: (anchor?: HTMLElement | null) => void
}

interface SidebarToastInput {
  anchor?: HTMLElement | null | undefined
  title: string
  description?: string
  type: 'error' | 'success' | 'warning'
}

function clearAnchoredSidebarToast(
  anchoredToastIdRef: React.RefObject<ReturnType<typeof anchoredToastManager.add> | null>
) {
  const previousToastId = anchoredToastIdRef.current
  if (!previousToastId) {
    return
  }
  anchoredToastManager.close(previousToastId)
  anchoredToastIdRef.current = null
}

function addAnchoredSidebarToast(input: {
  anchoredToastIdRef: React.RefObject<ReturnType<typeof anchoredToastManager.add> | null>
  toast: SidebarToastInput
}) {
  clearAnchoredSidebarToast(input.anchoredToastIdRef)
  input.anchoredToastIdRef.current = anchoredToastManager.add({
    ...input.toast,
    positionerProps: {
      anchor: input.toast.anchor,
      sideOffset: 10,
    },
    data: {
      dismissAfterVisibleMs: 2600,
    },
  })
}

function createSidebarToastDispatcher(
  anchoredToastIdRef: React.RefObject<ReturnType<typeof anchoredToastManager.add> | null>
) {
  return (input: SidebarToastInput) => {
    const description = input.description?.trim()
    const toast = {
      ...input,
      ...(description ? { description } : {}),
    }

    if (!toast.anchor) {
      clearAnchoredSidebarToast(anchoredToastIdRef)
      toastManager.add(toast)
      return
    }

    addAnchoredSidebarToast({
      anchoredToastIdRef,
      toast,
    })
  }
}

// ---------------------------------------------------------------------------
// Click handler (extracted to reduce hook body line count)
// ---------------------------------------------------------------------------

function runDesktopUpdateCheck(input: {
  bridge: NonNullable<typeof window.desktopBridge>
  desktopUpdateState: DesktopUpdateState | null
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  setManualCheckInFlight: React.Dispatch<React.SetStateAction<boolean>>
  showSidebarToast: (input: SidebarToastInput) => void
  anchor?: HTMLElement | null | undefined
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
          input.showSidebarToast({
            type: 'success',
            title: "You're up to date",
            description: `${result.state.currentVersion} is currently the newest version available.`,
            anchor: input.anchor,
          })
        }
        return
      }
      input.showSidebarToast({
        type: 'warning',
        title: 'Updates unavailable',
        description: result.state.message ?? 'Automatic updates are not available in this build.',
        anchor: input.anchor,
      })
    })
    .catch(error =>
      input.showSidebarToast({
        type: 'error',
        title: 'Could not check for updates',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        anchor: input.anchor,
      })
    )
    .finally(() => {
      input.setManualCheckInFlight(false)
    })
}

interface DesktopUpdateClickOpts {
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonDisabled: boolean
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  setManualCheckInFlight: React.Dispatch<React.SetStateAction<boolean>>
  showSidebarToast: (input: SidebarToastInput) => void
  anchor?: HTMLElement | null | undefined
}

interface DesktopUpdateActionRunOpts {
  bridge: NonNullable<typeof window.desktopBridge>
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  showSidebarToast: (input: SidebarToastInput) => void
  anchor?: HTMLElement | null | undefined
}

function maybeToastDesktopUpdateActionError(input: {
  result: Parameters<typeof shouldToastDesktopUpdateActionResult>[0]
  title: string
  showSidebarToast: (input: SidebarToastInput) => void
  anchor?: HTMLElement | null | undefined
}) {
  if (!shouldToastDesktopUpdateActionResult(input.result)) return
  const err = getDesktopUpdateActionError(input.result)
  if (!err) return
  input.showSidebarToast({
    type: 'error',
    title: input.title,
    description: err,
    anchor: input.anchor,
  })
}

function toastUnexpectedDesktopUpdateError(input: {
  title: string
  error: unknown
  showSidebarToast: (input: SidebarToastInput) => void
  anchor?: HTMLElement | null | undefined
}) {
  input.showSidebarToast({
    type: 'error',
    title: input.title,
    description:
      input.error instanceof Error ? input.error.message : 'An unexpected error occurred.',
    anchor: input.anchor,
  })
}

function runDesktopUpdateDownload(opts: DesktopUpdateActionRunOpts) {
  const { bridge, setDesktopUpdateState, showSidebarToast, anchor } = opts
  void bridge.downloadUpdate().then(
    result => {
      setDesktopUpdateState(result.state)
      if (result.completed) {
        showSidebarToast({
          type: 'success',
          title: 'Update downloaded',
          description: 'Restart the app from the update button to install it.',
          anchor,
        })
      }
      maybeToastDesktopUpdateActionError({
        result,
        title: 'Could not download update',
        showSidebarToast,
        anchor,
      })
    },
    error =>
      toastUnexpectedDesktopUpdateError({
        title: 'Could not start update download',
        error,
        showSidebarToast,
        anchor,
      })
  )
}

function runDesktopUpdateInstall(
  opts: DesktopUpdateActionRunOpts & {
    desktopUpdateState: DesktopUpdateState
  }
) {
  const { bridge, desktopUpdateState, setDesktopUpdateState, showSidebarToast, anchor } = opts
  const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(desktopUpdateState))
  if (!confirmed) return
  void bridge.installUpdate().then(
    result => {
      setDesktopUpdateState(result.state)
      maybeToastDesktopUpdateActionError({
        result,
        title: 'Could not install update',
        showSidebarToast,
        anchor,
      })
    },
    error =>
      toastUnexpectedDesktopUpdateError({
        title: 'Could not install update',
        error,
        showSidebarToast,
        anchor,
      })
  )
}

function execDesktopUpdateClick(opts: DesktopUpdateClickOpts) {
  const {
    desktopUpdateState,
    desktopUpdateButtonDisabled,
    desktopUpdateButtonAction,
    setDesktopUpdateState,
    setManualCheckInFlight,
    showSidebarToast,
    anchor,
  } = opts
  const bridge = window.desktopBridge
  if (!bridge) return
  if (desktopUpdateButtonDisabled) return

  if (desktopUpdateButtonAction === 'download' && desktopUpdateState) {
    runDesktopUpdateDownload({
      bridge,
      setDesktopUpdateState,
      showSidebarToast,
      anchor,
    })
    return
  }

  if (desktopUpdateButtonAction === 'install' && desktopUpdateState) {
    runDesktopUpdateInstall({
      bridge,
      desktopUpdateState,
      setDesktopUpdateState,
      showSidebarToast,
      anchor,
    })
    return
  }

  runDesktopUpdateCheck({
    bridge,
    desktopUpdateState,
    setDesktopUpdateState,
    setManualCheckInFlight,
    showSidebarToast,
    anchor,
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarDesktopUpdate(): SidebarDesktopUpdateReturn {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null)
  const [manualCheckInFlight, setManualCheckInFlight] = useState(false)
  const anchoredToastIdRef = useRef<ReturnType<typeof anchoredToastManager.add> | null>(null)

  useEffect(() => {
    return () => {
      clearAnchoredSidebarToast(anchoredToastIdRef)
    }
  }, [])

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

  const showSidebarToast = (input: SidebarToastInput) =>
    createSidebarToastDispatcher(anchoredToastIdRef)(input)

  function handleDesktopUpdateButtonClick(anchor?: HTMLElement | null) {
    execDesktopUpdateClick({
      desktopUpdateState: visibleDesktopUpdateState,
      desktopUpdateButtonDisabled,
      desktopUpdateButtonAction,
      setDesktopUpdateState,
      setManualCheckInFlight,
      showSidebarToast,
      anchor,
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
