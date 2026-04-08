import { type PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ThreadId } from '@orxa-code/contracts'
import { DEFAULT_THREAD_TERMINAL_HEIGHT } from '../types'

const MIN_DRAWER_HEIGHT = 180
const MAX_DRAWER_HEIGHT_RATIO = 0.75

function maxDrawerHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_THREAD_TERMINAL_HEIGHT
  return Math.max(MIN_DRAWER_HEIGHT, Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_RATIO))
}

export function clampDrawerHeight(height: number): number {
  const safeHeight = Number.isFinite(height) ? height : DEFAULT_THREAD_TERMINAL_HEIGHT
  const maxHeight = maxDrawerHeight()
  return Math.min(Math.max(Math.round(safeHeight), MIN_DRAWER_HEIGHT), maxHeight)
}

export interface TerminalDrawerResizeState {
  drawerHeight: number
  resizeEpoch: number
  handleResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleResizePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
}

interface ResizePointerState {
  pointerId: number
  startY: number
  startHeight: number
}

function usePointerDownHandler(
  drawerHeightRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      didResizeDuringDragRef.current = false
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: drawerHeightRef.current,
      }
    },
    [didResizeDuringDragRef, drawerHeightRef, resizeStateRef]
  )
}

function usePointerMoveHandler(
  drawerHeightRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  setDrawerHeight: (height: number) => void
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return
      event.preventDefault()
      const clampedHeight = clampDrawerHeight(
        resizeState.startHeight + (resizeState.startY - event.clientY)
      )
      if (clampedHeight === drawerHeightRef.current) return
      didResizeDuringDragRef.current = true
      drawerHeightRef.current = clampedHeight
      setDrawerHeight(clampedHeight)
    },
    [didResizeDuringDragRef, drawerHeightRef, resizeStateRef, setDrawerHeight]
  )
}

function usePointerEndHandler(
  drawerHeightRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  setResizeEpoch: React.Dispatch<React.SetStateAction<number>>,
  syncHeight: (nextHeight: number) => void
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return
      resizeStateRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (!didResizeDuringDragRef.current) return
      syncHeight(drawerHeightRef.current)
      setResizeEpoch(value => value + 1)
    },
    [didResizeDuringDragRef, drawerHeightRef, resizeStateRef, setResizeEpoch, syncHeight]
  )
}

function useWindowResizeSync(
  drawerHeightRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  setDrawerHeight: (height: number) => void,
  setResizeEpoch: React.Dispatch<React.SetStateAction<number>>,
  syncHeight: (nextHeight: number) => void
) {
  useEffect(() => {
    const onWindowResize = () => {
      const clampedHeight = clampDrawerHeight(drawerHeightRef.current)
      const changed = clampedHeight !== drawerHeightRef.current
      if (changed) {
        setDrawerHeight(clampedHeight)
        drawerHeightRef.current = clampedHeight
      }
      if (!resizeStateRef.current) syncHeight(clampedHeight)
      setResizeEpoch(value => value + 1)
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
    }
  }, [drawerHeightRef, resizeStateRef, setDrawerHeight, setResizeEpoch, syncHeight])
}

function useSyncHeight(
  lastSyncedHeightRef: React.MutableRefObject<number>,
  onHeightChangeRef: React.MutableRefObject<(height: number) => void>
) {
  return useCallback(
    (nextHeight: number) => {
      const clampedHeight = clampDrawerHeight(nextHeight)
      if (lastSyncedHeightRef.current === clampedHeight) return
      lastSyncedHeightRef.current = clampedHeight
      onHeightChangeRef.current(clampedHeight)
    },
    [lastSyncedHeightRef, onHeightChangeRef]
  )
}

export function useTerminalDrawerResize(
  height: number,
  threadId: ThreadId,
  onHeightChange: (height: number) => void
): TerminalDrawerResizeState {
  const [drawerHeight, setDrawerHeight] = useState(() => clampDrawerHeight(height))
  const [resizeEpoch, setResizeEpoch] = useState(0)
  const drawerHeightRef = useRef(drawerHeight)
  const lastSyncedHeightRef = useRef(clampDrawerHeight(height))
  const onHeightChangeRef = useRef(onHeightChange)
  const resizeStateRef = useRef<ResizePointerState | null>(null)
  const didResizeDuringDragRef = useRef(false)
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange
  }, [onHeightChange])
  useEffect(() => {
    drawerHeightRef.current = drawerHeight
  }, [drawerHeight])
  const syncHeight = useSyncHeight(lastSyncedHeightRef, onHeightChangeRef)
  useEffect(() => {
    const clampedHeight = clampDrawerHeight(height)
    setDrawerHeight(clampedHeight)
    drawerHeightRef.current = clampedHeight
    lastSyncedHeightRef.current = clampedHeight
  }, [height, threadId])
  const handleResizePointerDown = usePointerDownHandler(
    drawerHeightRef,
    resizeStateRef,
    didResizeDuringDragRef
  )
  const handleResizePointerMove = usePointerMoveHandler(
    drawerHeightRef,
    resizeStateRef,
    didResizeDuringDragRef,
    setDrawerHeight
  )
  const handleResizePointerEnd = usePointerEndHandler(
    drawerHeightRef,
    resizeStateRef,
    didResizeDuringDragRef,
    setResizeEpoch,
    syncHeight
  )
  useWindowResizeSync(drawerHeightRef, resizeStateRef, setDrawerHeight, setResizeEpoch, syncHeight)
  useEffect(() => () => syncHeight(drawerHeightRef.current), [syncHeight])
  return {
    drawerHeight,
    resizeEpoch,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  }
}
