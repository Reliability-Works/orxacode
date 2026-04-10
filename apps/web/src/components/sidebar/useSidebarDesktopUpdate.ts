/**
 * useSidebarDesktopUpdate — desktop update state subscription and click handler.
 */

import { useEffect, useRef, useState } from 'react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { anchoredToastManager, toastManager } from '../ui/toastState'
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
import { useManualDesktopUpdateCheck } from '../useManualDesktopUpdateCheck'

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
  startManualCheck: (anchor?: HTMLElement | null) => void
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
  input.startManualCheck(input.anchor)
}

interface DesktopUpdateClickOpts {
  desktopUpdateState: DesktopUpdateState | null
  desktopUpdateButtonDisabled: boolean
  desktopUpdateButtonAction: 'download' | 'install' | 'none'
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
  startManualCheck: (anchor?: HTMLElement | null) => void
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
    startManualCheck,
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
    startManualCheck,
    showSidebarToast,
    anchor,
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useDesktopUpdateStateSubscription(
  setDesktopUpdateState: React.Dispatch<React.SetStateAction<DesktopUpdateState | null>>
) {
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
  }, [setDesktopUpdateState])
}

export function useSidebarDesktopUpdate(): SidebarDesktopUpdateReturn {
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null)
  const anchoredToastIdRef = useRef<ReturnType<typeof anchoredToastManager.add> | null>(null)

  useEffect(() => {
    return () => {
      clearAnchoredSidebarToast(anchoredToastIdRef)
    }
  }, [])
  useDesktopUpdateStateSubscription(setDesktopUpdateState)

  const showSidebarToast = (input: SidebarToastInput) =>
    createSidebarToastDispatcher(anchoredToastIdRef)(input)
  const bridge = isElectron ? window.desktopBridge : null
  const { startManualCheck } = useManualDesktopUpdateCheck({
    state: desktopUpdateState,
    setState: setDesktopUpdateState,
    bridge,
    showToast: toast =>
      showSidebarToast({
        ...toast,
      }),
  })

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

  function handleDesktopUpdateButtonClick(anchor?: HTMLElement | null) {
    execDesktopUpdateClick({
      desktopUpdateState,
      desktopUpdateButtonDisabled,
      desktopUpdateButtonAction,
      setDesktopUpdateState,
      startManualCheck,
      showSidebarToast,
      anchor,
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
