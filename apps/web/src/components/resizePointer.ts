'use no memo'

import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react'

export interface ResizePointerState {
  readonly pointerId: number
  readonly startCoordinate: number
  readonly startSize: number
}

export function startPointerResizeDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  input: {
    readonly startCoordinate: number
    readonly startSize: number
    readonly onStart?: () => void
  }
) {
  if (event.button !== 0) return
  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  input.onStart?.()
  didResizeDuringDragRef.current = false
  resizeStateRef.current = {
    pointerId: event.pointerId,
    startCoordinate: input.startCoordinate,
    startSize: input.startSize,
  }
}

export function usePointerResizeDownHandler(
  sizeRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  input: {
    readonly coordinateForEvent: (event: ReactPointerEvent<HTMLDivElement>) => number
    readonly onStart?: () => void
  }
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      startPointerResizeDrag(event, resizeStateRef, didResizeDuringDragRef, {
        startCoordinate: input.coordinateForEvent(event),
        startSize: sizeRef.current,
        ...(input.onStart ? { onStart: input.onStart } : {}),
      })
    },
    [didResizeDuringDragRef, input, resizeStateRef, sizeRef]
  )
}

export function usePointerResizeEndHandler(
  sizeRef: React.MutableRefObject<number>,
  resizeStateRef: React.MutableRefObject<ResizePointerState | null>,
  didResizeDuringDragRef: React.MutableRefObject<boolean>,
  onCommit: (size: number) => void,
  onEnd?: () => void
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return
      resizeStateRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      onEnd?.()
      if (!didResizeDuringDragRef.current) return
      onCommit(sizeRef.current)
    },
    [didResizeDuringDragRef, onCommit, onEnd, resizeStateRef, sizeRef]
  )
}

export function useWindowResizeClampSync(input: {
  readonly sizeRef: React.MutableRefObject<number>
  readonly resizeStateRef: React.MutableRefObject<ResizePointerState | null>
  readonly setSize: (size: number) => void
  readonly syncSize: (size: number) => void
  readonly clampSize: (size: number) => number
  readonly onResize?: (size: number, changed: boolean) => void
  readonly onCleanup?: () => void
}) {
  useEffect(() => {
    const onWindowResize = () => {
      const clampedSize = input.clampSize(input.sizeRef.current)
      const changed = clampedSize !== input.sizeRef.current
      if (changed) {
        input.setSize(clampedSize)
        input.sizeRef.current = clampedSize
      }
      if (!input.resizeStateRef.current) input.syncSize(clampedSize)
      input.onResize?.(clampedSize, changed)
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      input.onCleanup?.()
    }
  }, [input])
}
