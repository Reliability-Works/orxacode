import { useCallback, useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@orxa-code/contracts'
import {
  beginDesktopUpdateCheckState,
  resolveDesktopUpdateManualCheckToast,
} from './desktopUpdate.logic'

export interface ManualDesktopUpdateToast {
  type: 'error' | 'success' | 'warning'
  title: string
  description?: string
  anchor?: HTMLElement | null | undefined
}

export function useManualDesktopUpdateCheck(input: {
  state: DesktopUpdateState | null
  setState: (state: DesktopUpdateState | null) => void
  showToast: (toast: ManualDesktopUpdateToast) => void
  bridge: NonNullable<typeof window.desktopBridge> | null | undefined
}) {
  const { state, setState, showToast, bridge } = input
  const [manualCheckPending, setManualCheckPending] = useState(false)

  useEffect(() => {
    if (!manualCheckPending) {
      return
    }
    const toast = resolveDesktopUpdateManualCheckToast(state)
    if (!toast) {
      return
    }
    setManualCheckPending(false)
    showToast(toast)
  }, [manualCheckPending, setState, showToast, state])

  const startManualCheck = useCallback(
    (anchor?: HTMLElement | null) => {
      if (!bridge || typeof bridge.checkForUpdate !== 'function') {
        return
      }
      setManualCheckPending(true)
      setState(beginDesktopUpdateCheckState(state))
      void bridge
        .checkForUpdate()
        .then(result => {
          setState(result.state)
          if (result.checked) {
            return
          }
          setManualCheckPending(false)
          const toast = resolveDesktopUpdateManualCheckToast(result.state)
          if (!toast) {
            return
          }
          showToast({
            ...toast,
            anchor,
          })
        })
        .catch((error: unknown) => {
          setManualCheckPending(false)
          showToast({
            type: 'error',
            title: 'Could not check for updates',
            description: error instanceof Error ? error.message : 'Update check failed.',
            anchor,
          })
        })
    },
    [bridge, setState, showToast, state]
  )

  return {
    manualCheckPending,
    startManualCheck,
  }
}
