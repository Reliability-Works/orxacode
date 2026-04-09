'use no memo'

import { type PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_CHAT_AUX_SIDEBAR_WIDTH = 384
const MIN_CHAT_AUX_SIDEBAR_WIDTH = 320
const MAX_CHAT_AUX_SIDEBAR_WIDTH_RATIO = 0.7

interface ResizePointerState {
  pointerId: number
  startX: number
  startWidth: number
}

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
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      didResizeDuringDragRef.current = false
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebarWidthRef.current,
      }
    },
    [didResizeDuringDragRef, resizeStateRef, sidebarWidthRef]
  )
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
        resizeState.startWidth + (resizeState.startX - event.clientX)
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
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return
      resizeStateRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      if (!didResizeDuringDragRef.current) return
      syncWidth(sidebarWidthRef.current)
    },
    [didResizeDuringDragRef, resizeStateRef, sidebarWidthRef, syncWidth]
  )
}

function useWindowResizeSync(
  sidebarWidthRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  setSidebarWidth: (width: number) => void,
  syncWidth: (width: number) => void
) {
  useEffect(() => {
    const onWindowResize = () => {
      const clampedWidth = clampChatAuxSidebarWidth(sidebarWidthRef.current)
      const changed = clampedWidth !== sidebarWidthRef.current
      if (changed) {
        setSidebarWidth(clampedWidth)
        sidebarWidthRef.current = clampedWidth
      }
      if (!resizeStateRef.current) syncWidth(clampedWidth)
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
  }, [resizeStateRef, setSidebarWidth, sidebarWidthRef, syncWidth])
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

  useWindowResizeSync(sidebarWidthRef, resizeStateRef, setSidebarWidth, syncWidth)

  return {
    sidebarWidth,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  }
}
