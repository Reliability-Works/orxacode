import { useCallback, useEffect, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'

const MIN_LEFT_PANE_WIDTH = 280
const MAX_LEFT_PANE_WIDTH = 520
const MIN_BROWSER_PANE_WIDTH = 320
const MAX_BROWSER_PANE_WIDTH = 760
const MIN_RIGHT_PANE_WIDTH = 280
const MAX_RIGHT_PANE_WIDTH = 760

type SidebarResizeContext = {
  browserPaneWidth: number
  browserSidebarOpen: boolean
  leftPaneWidth: number
  rightPaneWidth: number
  resizeStateRef: RefObject<ResizeState | null>
  setBrowserPaneWidth: (value: number) => void
  setLeftPaneWidth: (value: number) => void
  setRightPaneWidth: (value: number) => void
  showGitPane: boolean
  workspaceRef: RefObject<HTMLDivElement | null>
}

type ResizeState = {
  side: 'left' | 'browser' | 'mobile' | 'right'
  startX: number
  startWidth: number
  latestX: number
  currentWidth?: number
  rafId?: number
}

function getResizeStartWidth(
  side: 'left' | 'browser' | 'right',
  widths: { leftPaneWidth: number; browserPaneWidth: number; rightPaneWidth: number }
) {
  if (side === 'left') {
    return widths.leftPaneWidth
  }
  if (side === 'browser') {
    return widths.browserPaneWidth
  }
  return widths.rightPaneWidth
}

function updateLeftPaneWidth(state: ResizeState, workspaceRef: RefObject<HTMLDivElement | null>) {
  const next = Math.max(
    MIN_LEFT_PANE_WIDTH,
    Math.min(MAX_LEFT_PANE_WIDTH, state.startWidth + (state.latestX - state.startX))
  )
  workspaceRef.current?.style.setProperty('--left-pane-width', `${next}px`)
  document.documentElement.style.setProperty('--left-pane-width', `${next}px`)
  state.currentWidth = next
}

function updateBrowserPaneWidth(
  state: ResizeState,
  context: {
    browserPaneWidth: number
    rightPaneWidth: number
    showGitPane: boolean
    workspaceRef: RefObject<HTMLDivElement | null>
  }
) {
  const { browserPaneWidth, rightPaneWidth, showGitPane, workspaceRef } = context
  const workspaceWidth = workspaceRef.current?.offsetWidth ?? window.innerWidth
  const leftWidth = parseFloat(
    document.documentElement.style.getPropertyValue('--left-pane-width') || '300'
  )
  const leftVisible = parseFloat(
    document.documentElement.style.getPropertyValue('--left-pane-visible') || '1'
  )
  const leftActual = leftWidth * leftVisible
  const leftResizer = 4 * leftVisible
  const rightVisible = showGitPane ? 1 : 0
  const rightActual = rightPaneWidth * rightVisible
  const rightResizer = 4 * rightVisible
  const maxBrowser = Math.floor(
    workspaceWidth -
      leftActual -
      leftResizer -
      rightActual -
      rightResizer -
      workspaceWidth * 0.2 -
      4
  )
  const next = Math.max(
    MIN_BROWSER_PANE_WIDTH,
    Math.min(
      Math.max(MIN_BROWSER_PANE_WIDTH, Math.min(MAX_BROWSER_PANE_WIDTH, maxBrowser)),
      state.startWidth - (state.latestX - state.startX)
    )
  )
  workspaceRef.current?.style.setProperty('--browser-pane-width', `${next}px`)
  state.currentWidth = next
  void browserPaneWidth
}

function updateRightPaneWidth(
  state: ResizeState,
  context: {
    browserPaneWidth: number
    browserSidebarOpen: boolean
    workspaceRef: RefObject<HTMLDivElement | null>
  }
) {
  const { browserPaneWidth, browserSidebarOpen, workspaceRef } = context
  const workspaceWidth = workspaceRef.current?.offsetWidth ?? window.innerWidth
  const leftWidth = parseFloat(
    document.documentElement.style.getPropertyValue('--left-pane-width') || '300'
  )
  const leftVisible = parseFloat(
    document.documentElement.style.getPropertyValue('--left-pane-visible') || '1'
  )
  const leftActual = leftWidth * leftVisible
  const leftResizer = 4 * leftVisible
  const browserVisible = browserSidebarOpen ? 1 : 0
  const browserActual = browserPaneWidth * browserVisible
  const browserResizer = 4 * browserVisible
  const maxRight = Math.floor(
    workspaceWidth -
      leftActual -
      leftResizer -
      browserActual -
      browserResizer -
      workspaceWidth * 0.2 -
      4
  )
  const next = Math.max(
    MIN_RIGHT_PANE_WIDTH,
    Math.min(
      Math.max(MIN_RIGHT_PANE_WIDTH, Math.min(MAX_RIGHT_PANE_WIDTH, maxRight)),
      state.startWidth - (state.latestX - state.startX)
    )
  )
  workspaceRef.current?.style.setProperty('--right-pane-width', `${next}px`)
  state.currentWidth = next
}

function applyResizeFrame(
  state: ResizeState,
  context: {
    browserPaneWidth: number
    browserSidebarOpen: boolean
    rightPaneWidth: number
    showGitPane: boolean
    workspaceRef: RefObject<HTMLDivElement | null>
  }
) {
  if (state.side === 'left') {
    updateLeftPaneWidth(state, context.workspaceRef)
    return
  }
  if (state.side === 'browser') {
    updateBrowserPaneWidth(state, context)
    return
  }
  updateRightPaneWidth(state, context)
}

function persistResizedWidth(
  state: ResizeState | null,
  setters: {
    setBrowserPaneWidth: (value: number) => void
    setLeftPaneWidth: (value: number) => void
    setRightPaneWidth: (value: number) => void
  }
) {
  if (state?.currentWidth === undefined) {
    return
  }
  if (state.side === 'left') {
    setters.setLeftPaneWidth(state.currentWidth)
    return
  }
  if (state.side === 'browser') {
    setters.setBrowserPaneWidth(state.currentWidth)
    return
  }
  setters.setRightPaneWidth(state.currentWidth)
}

export function useAppCoreSidebarResize(context: SidebarResizeContext) {
  const {
    browserPaneWidth,
    browserSidebarOpen,
    leftPaneWidth,
    rightPaneWidth,
    setBrowserPaneWidth,
    setLeftPaneWidth,
    setRightPaneWidth,
    showGitPane,
    workspaceRef,
    resizeStateRef,
  } = context

  const startSidebarResize = useCallback(
    (side: 'left' | 'browser' | 'right', event: ReactMouseEvent) => {
      event.preventDefault()
      const startWidth = getResizeStartWidth(side, {
        leftPaneWidth,
        browserPaneWidth,
        rightPaneWidth,
      })
      document.body.classList.add('is-resizing')
      resizeStateRef.current = { side, startX: event.clientX, startWidth, latestX: event.clientX }
    },
    [browserPaneWidth, leftPaneWidth, resizeStateRef, rightPaneWidth]
  )

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) {
        return
      }
      state.latestX = event.clientX
      if (state.rafId !== undefined) {
        return
      }
      state.rafId = requestAnimationFrame(() => {
        const s = resizeStateRef.current
        if (!s) {
          return
        }
        s.rafId = undefined
        applyResizeFrame(s, {
          browserPaneWidth,
          browserSidebarOpen,
          rightPaneWidth,
          showGitPane,
          workspaceRef,
        })
      })
    }

    const onMouseUp = () => {
      const state = resizeStateRef.current
      document.body.classList.remove('is-resizing')
      if (state?.rafId !== undefined) {
        cancelAnimationFrame(state.rafId)
      }
      persistResizedWidth(state, { setBrowserPaneWidth, setLeftPaneWidth, setRightPaneWidth })
      resizeStateRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.classList.remove('is-resizing')
    }
  }, [
    browserPaneWidth,
    browserSidebarOpen,
    resizeStateRef,
    rightPaneWidth,
    setBrowserPaneWidth,
    setLeftPaneWidth,
    setRightPaneWidth,
    showGitPane,
    workspaceRef,
  ])

  return {
    startSidebarResize,
  }
}
