import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserSidebarStateView } from '../lib/app-session-utils'

export interface BrowserAnnotation {
  id: string
  element: string
  selector: string
  comment: string
  boundingBox?: { x: number; y: number; width: number; height: number }
  computedStyles?: string
  timestamp: number
}

type BrowserSidebarStateHooksInput = {
  browserState: BrowserSidebarStateView
  onBrowserNavigate: (url: string) => Promise<void> | void
  onBrowserReportViewportBounds: (bounds: {
    x: number
    y: number
    width: number
    height: number
  }) => Promise<void> | void
  onStatusChange: (message: string) => void
}

export function useBrowserSidebarNavigation({
  browserState,
  onBrowserNavigate,
  onStatusChange,
}: Pick<BrowserSidebarStateHooksInput, 'browserState' | 'onBrowserNavigate' | 'onStatusChange'>) {
  const [browserUrlInput, setBrowserUrlInput] = useState('')
  const [browserHistoryValue, setBrowserHistoryValue] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menubarRef = useRef<HTMLElement | null>(null)

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  useEffect(() => {
    if (!openMenu) return
    const handleClick = (event: MouseEvent) => {
      if (menubarRef.current && !menubarRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [closeMenu, openMenu])

  useEffect(() => {
    setBrowserUrlInput(browserState.activeUrl)
  }, [browserState.activeUrl])

  useEffect(() => {
    setBrowserHistoryValue('')
  }, [browserState.history, browserState.activeTabID])

  const runBrowserAction = useCallback(
    (action: () => void | Promise<void>) => {
      void Promise.resolve(action()).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        onStatusChange(message)
      })
    },
    [onStatusChange]
  )

  const submitBrowserNavigation = useCallback(() => {
    const rawValue = browserUrlInput.trim()
    if (!rawValue) {
      return
    }
    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
    setBrowserUrlInput(normalized)
    runBrowserAction(() => onBrowserNavigate(normalized))
  }, [browserUrlInput, onBrowserNavigate, runBrowserAction])

  return {
    browserHistoryValue,
    browserUrlInput,
    closeMenu,
    menubarRef,
    openMenu,
    runBrowserAction,
    setBrowserHistoryValue,
    setBrowserUrlInput,
    setOpenMenu,
    submitBrowserNavigation,
  }
}

function buildBrowserAnnotationsMarkdown(
  activeUrl: string | undefined,
  annotations: BrowserAnnotation[]
) {
  const lines = ['## Browser Annotations', '']
  if (activeUrl) {
    lines.push(`**URL:** ${activeUrl}`, '')
  }
  for (const annotation of annotations) {
    lines.push(`- **${annotation.element}**`)
    lines.push(`  - Selector: \`${annotation.selector}\``)
    if (annotation.comment) {
      lines.push(`  - Note: ${annotation.comment}`)
    }
    if (annotation.boundingBox) {
      const { x, y, width, height } = annotation.boundingBox
      lines.push(`  - Bounds: ${width}x${height} at (${x}, ${y})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function useBrowserSidebarAnnotations(activeUrl: string | undefined) {
  const [inspectMode, setInspectMode] = useState(false)
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!window.orxa?.events?.subscribe) return
    const unsubscribe = window.orxa.events.subscribe((event: { type: string; payload: unknown }) => {
      if (event.type === 'browser.inspect.annotation' && inspectMode) {
        const payload = event.payload as {
          element: string
          selector: string
          boundingBox?: { x: number; y: number; width: number; height: number }
          computedStyles?: string
        }
        setAnnotations(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            element: payload.element,
            selector: payload.selector,
            comment: '',
            boundingBox: payload.boundingBox,
            computedStyles: payload.computedStyles,
            timestamp: Date.now(),
          },
        ])
      }
    })
    return unsubscribe
  }, [inspectMode])

  const updateAnnotationComment = useCallback((id: string, comment: string) => {
    setAnnotations(prev => prev.map(annotation => (annotation.id === id ? { ...annotation, comment } : annotation)))
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(annotation => annotation.id !== id))
  }, [])

  const clearAnnotations = useCallback(() => {
    setAnnotations([])
  }, [])

  const copyAnnotationsPrompt = useCallback(() => {
    if (annotations.length === 0) return
    const prompt = buildBrowserAnnotationsMarkdown(activeUrl, annotations) + '\nPlease review these annotated elements and address the notes above.'
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [activeUrl, annotations])

  return {
    annotations,
    clearAnnotations,
    copied,
    copyAnnotationsPrompt,
    inspectMode,
    removeAnnotation,
    setInspectMode,
    updateAnnotationComment,
  }
}

export function useBrowserSidebarViewportReporter({
  onBrowserReportViewportBounds,
  activeTabID,
  activeUrl,
}: Pick<BrowserSidebarStateHooksInput, 'onBrowserReportViewportBounds'> & {
  activeTabID?: string
  activeUrl?: string
}) {
  const browserViewportHostRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const host = browserViewportHostRef.current
    if (!host) {
      return
    }

    let frameID: number | null = null
    const report = () => {
      const rect = host.getBoundingClientRect()
      void onBrowserReportViewportBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    const schedule = () => {
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID)
      }
      frameID = window.requestAnimationFrame(() => {
        frameID = null
        report()
      })
    }

    report()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)

    let transitionFrameId: number | null = null
    let transitionEnd = 0
    const pollDuringTransition = () => {
      report()
      if (Date.now() < transitionEnd) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition)
      } else {
        transitionFrameId = null
      }
    }
    const handleTransitionStart = () => {
      transitionEnd = Date.now() + 400
      if (transitionFrameId === null) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition)
      }
    }
    const workspace = host.closest('.workspace')
    workspace?.addEventListener('transitionstart', handleTransitionStart)

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        schedule()
      })
      observer.observe(host)
    }
    return () => {
      observer?.disconnect()
      workspace?.removeEventListener('transitionstart', handleTransitionStart)
      if (transitionFrameId !== null) window.cancelAnimationFrame(transitionFrameId)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID)
      }
    }
  }, [activeTabID, activeUrl, onBrowserReportViewportBounds])

  return { browserViewportHostRef }
}
