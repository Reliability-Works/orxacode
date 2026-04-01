import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

type ComposerResizeOptions = {
  minHeight: number
  maxHeight: number
  defaultHeight: number
}

export function useComposerResize({ minHeight, maxHeight, defaultHeight }: ComposerResizeOptions) {
  const [composerHeight, setComposerHeight] = useState(defaultHeight)
  const [composerResizeActive, setComposerResizeActive] = useState(false)
  const composerResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    if (!composerResizeActive) {
      return
    }

    const onPointerMove = (event: MouseEvent) => {
      const state = composerResizeRef.current
      if (!state) {
        return
      }
      const nextHeight = Math.max(
        minHeight,
        Math.min(maxHeight, state.startHeight + (state.startY - event.clientY))
      )
      setComposerHeight(nextHeight)
    }

    const onPointerUp = () => {
      setComposerResizeActive(false)
      composerResizeRef.current = null
    }

    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
    return () => {
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [composerResizeActive, maxHeight, minHeight])

  const startComposerResize = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      composerResizeRef.current = {
        startY: event.clientY,
        startHeight: composerHeight,
      }
      setComposerResizeActive(true)
    },
    [composerHeight]
  )

  return {
    composerHeight,
    composerResizeActive,
    startComposerResize,
  }
}
