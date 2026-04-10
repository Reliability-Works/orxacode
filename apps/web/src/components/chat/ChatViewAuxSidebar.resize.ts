'use no memo'

import { type PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ResizePointerState,
  usePointerResizeDownHandler,
  usePointerResizeEndHandler,
  useWindowResizeClampSync,
} from '../resizePointer'

const DEFAULT_CHAT_AUX_SIDEBAR_WIDTH = 384
const MIN_CHAT_AUX_SIDEBAR_WIDTH = 320
const MAX_CHAT_AUX_SIDEBAR_WIDTH_RATIO = 0.7

function maxAuxSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_CHAT_AUX_SIDEBAR_WIDTH
  return Math.max(
    MIN_CHAT_AUX_SIDEBAR_WIDTH,
    Math.floor(window.innerWidth * MAX_CHAT_AUX_SIDEBAR_WIDTH_RATIO)
  )
}

export function clampChatAuxSidebarWidth(width: number): number {
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_CHAT_AUX_SIDEBAR_WIDTH
  return Math.min(Math.max(Math.round(safeWidth), MIN_CHAT_AUX_SIDEBAR_WIDTH), maxAuxSidebarWidth())
}

function useSyncWidth(
  lastSyncedWidthRef: React.MutableRefObject<number>,
  onWidthChangeRef: React.MutableRefObject<(width: number) => void>
) {
  return useCallback(
    (nextWidth: number) => {
      const clampedWidth = clampChatAuxSidebarWidth(nextWidth)
      if (lastSyncedWidthRef.current === clampedWidth) return
      lastSyncedWidthRef.current = clampedWidth
      onWidthChangeRef.current(clampedWidth)
    },
    [lastSyncedWidthRef, onWidthChangeRef]
  )
}

function usePointerDownHandler(
  sidebarWidthRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>
) {
  return usePointerResizeDownHandler(sidebarWidthRef, resizeStateRef, didResizeDuringDragRef, {
    coordinateForEvent: event => event.clientX,
    onStart: () => {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
  })
}

function usePointerMoveHandler(
  sidebarWidthRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  setSidebarWidth: (width: number) => void
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return
      event.preventDefault()
      const clampedWidth = clampChatAuxSidebarWidth(
        resizeState.startSize + (resizeState.startCoordinate - event.clientX)
      )
      if (clampedWidth === sidebarWidthRef.current) return
      didResizeDuringDragRef.current = true
      sidebarWidthRef.current = clampedWidth
      setSidebarWidth(clampedWidth)
    },
    [didResizeDuringDragRef, resizeStateRef, setSidebarWidth, sidebarWidthRef]
  )
}

function usePointerEndHandler(
  sidebarWidthRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  syncWidth: (width: number) => void
) {
  return usePointerResizeEndHandler(
    sidebarWidthRef,
    resizeStateRef,
    didResizeDuringDragRef,
    nextWidth => {
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      syncWidth(nextWidth)
    },
    () => {
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
  )
}

export function useChatAuxSidebarResize(
  width: number,
  onWidthChange: (width: number) => void
): {
  sidebarWidth: number
  handleResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleResizePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
} {
  const [sidebarWidth, setSidebarWidth] = useState(() => clampChatAuxSidebarWidth(width))
  const sidebarWidthRef = useRef(sidebarWidth)
  const lastSyncedWidthRef = useRef(clampChatAuxSidebarWidth(width))
  const onWidthChangeRef = useRef(onWidthChange)
  const resizeStateRef = useRef<ResizePointerState | null>(null)
  const didResizeDuringDragRef = useRef(false)

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange
  }, [onWidthChange])

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    const clampedWidth = clampChatAuxSidebarWidth(width)
    setSidebarWidth(clampedWidth)
    sidebarWidthRef.current = clampedWidth
    lastSyncedWidthRef.current = clampedWidth
  }, [width])

  const syncWidth = useSyncWidth(lastSyncedWidthRef, onWidthChangeRef)
  const handleResizePointerDown = usePointerDownHandler(
    sidebarWidthRef,
    resizeStateRef,
    didResizeDuringDragRef
  )
  const handleResizePointerMove = usePointerMoveHandler(
    sidebarWidthRef,
    resizeStateRef,
    didResizeDuringDragRef,
    setSidebarWidth
  )
  const handleResizePointerEnd = usePointerEndHandler(
    sidebarWidthRef,
    resizeStateRef,
    didResizeDuringDragRef,
    syncWidth
  )

  useWindowResizeClampSync({
    sizeRef: sidebarWidthRef,
    resizeStateRef,
    setSize: setSidebarWidth,
    syncSize: syncWidth,
    clampSize: clampChatAuxSidebarWidth,
    onCleanup: () => {
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    },
  })

  return {
    sidebarWidth,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  }
}
