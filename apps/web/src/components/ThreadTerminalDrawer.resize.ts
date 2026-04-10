'use no memo'

import { type PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ThreadId } from '@orxa-code/contracts'
import { DEFAULT_THREAD_TERMINAL_HEIGHT } from '../types'
import {
  ResizePointerState,
  usePointerResizeDownHandler,
  usePointerResizeEndHandler,
  useWindowResizeClampSync,
} from './resizePointer'

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

function usePointerDownHandler(
  drawerHeightRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>
) {
  return usePointerResizeDownHandler(drawerHeightRef, resizeStateRef, didResizeDuringDragRef, {
    coordinateForEvent: event => event.clientY,
  })
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
        resizeState.startSize + (resizeState.startCoordinate - event.clientY)
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
  return usePointerResizeEndHandler(
    drawerHeightRef,
    resizeStateRef,
    didResizeDuringDragRef,
    nextHeight => {
      syncHeight(nextHeight)
      setResizeEpoch(value => value + 1)
    }
  )
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
  useWindowResizeClampSync({
    sizeRef: drawerHeightRef,
    resizeStateRef,
    setSize: setDrawerHeight,
    syncSize: syncHeight,
    clampSize: clampDrawerHeight,
    onResize: () => setResizeEpoch(value => value + 1),
  })
  useEffect(() => () => syncHeight(drawerHeightRef.current), [syncHeight])
  return {
    drawerHeight,
    resizeEpoch,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  }
}
