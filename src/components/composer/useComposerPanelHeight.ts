import { useLayoutEffect, type RefObject } from 'react'

export function useComposerPanelHeight(
  ref: RefObject<HTMLElement | null>,
  onLayoutHeightChange?: (height: number) => void
) {
  useLayoutEffect(() => {
    if (!onLayoutHeightChange) {
      return
    }
    const element = ref.current
    if (!element) {
      return
    }
    let frameId: number | null = null
    const report = () => {
      onLayoutHeightChange(Math.max(0, Math.round(element.getBoundingClientRect().height)))
    }
    const scheduleReport = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        report()
      })
    }
    report()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleReport)
      return () => {
        window.removeEventListener('resize', scheduleReport)
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId)
        }
      }
    }
    const observer = new ResizeObserver(() => {
      scheduleReport()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [onLayoutHeightChange, ref])
}
