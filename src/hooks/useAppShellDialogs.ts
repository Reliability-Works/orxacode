import { useCallback, useRef, useState } from 'react'
import type { ConfirmDialogProps } from '../components/ConfirmDialog'
import type { TextInputDialogProps } from '../components/TextInputDialog'

export type AppShellTextInputDialogState = Omit<TextInputDialogProps, 'isOpen' | 'onCancel'>
export type AppShellConfirmDialogRequest = Omit<
  ConfirmDialogProps,
  'isOpen' | 'onConfirm' | 'onCancel'
>

export function useAppShellDialogs() {
  const [confirmDialogRequest, setConfirmDialogRequest] =
    useState<AppShellConfirmDialogRequest | null>(null)
  const [textInputDialog, setTextInputDialog] = useState<AppShellTextInputDialogState | null>(null)
  const confirmDialogResolverRef = useRef<((value: boolean) => void) | null>(null)

  const requestConfirmation = useCallback((request: AppShellConfirmDialogRequest) => {
    return new Promise<boolean>(resolve => {
      setConfirmDialogRequest(request)
      confirmDialogResolverRef.current = resolve
    })
  }, [])

  const closeConfirmDialog = useCallback((confirmed: boolean) => {
    const resolver = confirmDialogResolverRef.current
    confirmDialogResolverRef.current = null
    setConfirmDialogRequest(null)
    resolver?.(confirmed)
  }, [])

  const closeTextInputDialog = useCallback(() => {
    setTextInputDialog(null)
  }, [])

  const submitTextInputDialog = useCallback(
    (value: string) => {
      const dialog = textInputDialog
      if (!dialog) {
        return
      }
      setTextInputDialog(null)
      void Promise.resolve(dialog.onConfirm(value))
    },
    [textInputDialog]
  )

  return {
    confirmDialogRequest,
    textInputDialog,
    setTextInputDialog,
    requestConfirmation,
    closeConfirmDialog,
    closeTextInputDialog,
    submitTextInputDialog,
  }
}
