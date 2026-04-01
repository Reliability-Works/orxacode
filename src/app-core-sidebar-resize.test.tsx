import { act, renderHook } from '@testing-library/react'
import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppCoreSidebarResize } from './app-core-sidebar-resize'

function buildWorkspaceRef(width: number) {
  const element = document.createElement('div')
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    value: width,
  })
  return element
}

describe('useAppCoreSidebarResize', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    document.documentElement.style.removeProperty('--left-pane-width')
    document.documentElement.style.removeProperty('--left-pane-visible')
    document.body.classList.remove('is-resizing')
  })

  it('shrinks the right sidebar when dragging the resizer to the right', () => {
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()

    document.documentElement.style.setProperty('--left-pane-width', '300')
    document.documentElement.style.setProperty('--left-pane-visible', '1')

    const setRightPaneWidth = vi.fn()
    const workspaceElement = buildWorkspaceRef(1440)

    const { result } = renderHook(() => {
      const resizeStateRef = useRef<{
        side: 'left' | 'browser' | 'mobile' | 'right'
        startX: number
        startWidth: number
        latestX: number
        currentWidth?: number
        rafId?: number
      } | null>(null)
      const workspaceRef = useRef<HTMLDivElement | null>(workspaceElement)

      return useAppCoreSidebarResize({
        resizeStateRef,
        browserPaneWidth: 360,
        browserSidebarOpen: false,
        leftPaneWidth: 300,
        rightPaneWidth: 400,
        setBrowserPaneWidth: vi.fn(),
        setLeftPaneWidth: vi.fn(),
        setRightPaneWidth,
        showGitPane: true,
        workspaceRef,
      })
    })

    act(() => {
      result.current.startSidebarResize(
        'right',
        {
          clientX: 100,
          preventDefault: vi.fn(),
        } as unknown as ReactMouseEvent
      )
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    })

    expect(workspaceElement.style.getPropertyValue('--right-pane-width')).toBe('360px')

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(setRightPaneWidth).toHaveBeenCalledWith(360)
  })
})
