/**
 * useSidebarInteractionState — delete confirmation state, selection clear effect,
 * and PR link opener. Extracted from useSidebarCallbackFactories to reduce line count.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadId } from '@orxa-code/contracts'
import { readNativeApi } from '../../nativeApi'
import { toastManager } from '../ui/toastState'
import { shouldClearThreadSelectionOnMouseDown } from '../Sidebar.logic'

export function useSidebarInteractionState(params: {
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
}) {
  const { selectedThreadIds, clearSelection } = params

  const [confirmingDeleteThreadId, setConfirmingDeleteThreadId] = useState<ThreadId | null>(null)
  const confirmDeleteButtonRefs = useRef(new Map<ThreadId, HTMLButtonElement>())

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!shouldClearThreadSelectionOnMouseDown(target)) return
      clearSelection()
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [clearSelection, selectedThreadIds.size])

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault()
    event.stopPropagation()
    const api = readNativeApi()
    if (!api) {
      toastManager.add({ type: 'error', title: 'Link opening is unavailable.' })
      return
    }
    void api.shell.openExternal(prUrl).catch(error => {
      toastManager.add({
        type: 'error',
        title: 'Unable to open PR link',
        description: error instanceof Error ? error.message : 'An error occurred.',
      })
    })
  }, [])

  return {
    confirmingDeleteThreadId,
    setConfirmingDeleteThreadId,
    confirmDeleteButtonRefs,
    openPrLink,
  }
}
