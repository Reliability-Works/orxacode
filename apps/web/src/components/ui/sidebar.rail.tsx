import { Schema } from 'effect'
import * as React from 'react'

import { cn } from '~/lib/utils'
import { getLocalStorageItem, setLocalStorageItem } from '~/hooks/useLocalStorage'

import {
  clampSidebarWidth,
  SidebarInstanceContext,
  type SidebarResolvedResizableOptions,
  useSidebar,
} from './sidebar.shared'

type ResizeState = {
  moved: boolean
  pointerId: number
  pendingWidth: number
  rail: HTMLButtonElement
  rafId: number | null
  sidebarRoot: HTMLElement
  side: 'left' | 'right'
  startWidth: number
  startX: number
  transitionTargets: HTMLElement[]
  width: number
  wrapper: HTMLElement
}

function clearResizeStyles() {
  document.body.style.removeProperty('cursor')
  document.body.style.removeProperty('user-select')
}

function restoreResizeTransitions(transitionTargets: HTMLElement[], rafId: number | null) {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId)
  }
  transitionTargets.forEach(element => {
    element.style.removeProperty('transition-duration')
  })
}

function findResizeElements(rail: HTMLButtonElement) {
  const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']")
  const sidebarRoot = rail.closest<HTMLElement>("[data-slot='sidebar']")
  if (!wrapper || !sidebarRoot) {
    return null
  }

  const sidebarContainer = sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-container']")
  if (!sidebarContainer) {
    return null
  }

  return { wrapper, sidebarRoot, sidebarContainer }
}

function createResizeState(input: {
  event: React.PointerEvent<HTMLButtonElement>
  resolvedResizable: SidebarResolvedResizableOptions
  side: 'left' | 'right'
}) {
  const elements = findResizeElements(input.event.currentTarget)
  if (!elements) {
    return null
  }

  const startWidth = elements.sidebarContainer.getBoundingClientRect().width
  const initialWidth = clampSidebarWidth(startWidth, input.resolvedResizable)
  const transitionTargets = [
    elements.sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-gap']"),
    elements.sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-container']"),
  ].filter((element): element is HTMLElement => element !== null)
  transitionTargets.forEach(element => {
    element.style.setProperty('transition-duration', '0ms')
  })

  return {
    moved: false,
    pointerId: input.event.pointerId,
    pendingWidth: initialWidth,
    rail: input.event.currentTarget,
    rafId: null,
    sidebarRoot: elements.sidebarRoot,
    side: input.side,
    startWidth: initialWidth,
    startX: input.event.clientX,
    transitionTargets,
    width: initialWidth,
    wrapper: elements.wrapper,
  } satisfies ResizeState
}

function stopResize(input: {
  pointerId: number
  resizeStateRef: React.MutableRefObject<ResizeState | null>
  resolvedResizable: SidebarResolvedResizableOptions | null
}) {
  const resizeState = input.resizeStateRef.current
  if (!resizeState) {
    return
  }
  restoreResizeTransitions(resizeState.transitionTargets, resizeState.rafId)
  if (input.resolvedResizable?.storageKey && typeof window !== 'undefined') {
    setLocalStorageItem(input.resolvedResizable.storageKey, resizeState.width, Schema.Finite)
  }
  input.resolvedResizable?.onResize?.(resizeState.width)
  input.resizeStateRef.current = null
  if (resizeState.rail.hasPointerCapture(input.pointerId)) {
    resizeState.rail.releasePointerCapture(input.pointerId)
  }
  clearResizeStyles()
}

function handleResizePointerMove(input: {
  event: React.PointerEvent<HTMLButtonElement>
  onPointerMove: React.PointerEventHandler<HTMLButtonElement> | undefined
  resizeStateRef: React.MutableRefObject<ResizeState | null>
  resolvedResizable: SidebarResolvedResizableOptions | null
}) {
  input.onPointerMove?.(input.event)
  if (input.event.defaultPrevented) return
  const resizeState = input.resizeStateRef.current
  if (!resizeState || resizeState.pointerId !== input.event.pointerId || !input.resolvedResizable)
    return

  input.event.preventDefault()
  const delta =
    resizeState.side === 'right'
      ? resizeState.startX - input.event.clientX
      : input.event.clientX - resizeState.startX
  if (Math.abs(delta) > 2) {
    resizeState.moved = true
  }
  resizeState.pendingWidth = clampSidebarWidth(
    resizeState.startWidth + delta,
    input.resolvedResizable
  )
  if (resizeState.rafId !== null) {
    return
  }

  resizeState.rafId = window.requestAnimationFrame(() => {
    const activeResizeState = input.resizeStateRef.current
    if (!activeResizeState || !input.resolvedResizable) return

    activeResizeState.rafId = null
    const nextWidth = activeResizeState.pendingWidth
    const accepted =
      input.resolvedResizable.shouldAcceptWidth?.({
        currentWidth: activeResizeState.width,
        nextWidth,
        rail: activeResizeState.rail,
        side: activeResizeState.side,
        sidebarRoot: activeResizeState.sidebarRoot,
        wrapper: activeResizeState.wrapper,
      }) ?? true
    if (!accepted) {
      return
    }

    activeResizeState.wrapper.style.setProperty('--sidebar-width', `${nextWidth}px`)
    activeResizeState.width = nextWidth
  })
}

function restoreStoredWidth(
  rail: HTMLButtonElement | null,
  resolvedResizable: SidebarResolvedResizableOptions | null
) {
  if (!resolvedResizable?.storageKey || typeof window === 'undefined' || !rail) return
  const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']")
  if (!wrapper) return

  const storedWidth = getLocalStorageItem(resolvedResizable.storageKey, Schema.Finite)
  if (storedWidth === null) return
  const clampedWidth = clampSidebarWidth(storedWidth, resolvedResizable)
  wrapper.style.setProperty('--sidebar-width', `${clampedWidth}px`)
  resolvedResizable.onResize?.(clampedWidth)
}

function useSidebarResizeLifecycle(
  railRef: React.RefObject<HTMLButtonElement | null>,
  resizeStateRef: React.MutableRefObject<ResizeState | null>,
  resolvedResizable: SidebarResolvedResizableOptions | null
) {
  const cleanupResizeState = React.useCallback(() => {
    const resizeState = resizeStateRef.current
    if (resizeState) {
      restoreResizeTransitions(resizeState.transitionTargets, resizeState.rafId)
    }
    clearResizeStyles()
  }, [resizeStateRef])

  React.useEffect(() => {
    restoreStoredWidth(railRef.current, resolvedResizable)
  }, [railRef, resolvedResizable])

  React.useEffect(() => {
    return cleanupResizeState
  }, [cleanupResizeState])
}

type SidebarRailRefs = {
  railRef: React.RefObject<HTMLButtonElement | null>
  resizeStateRef: React.RefObject<ResizeState | null>
  suppressClickRef: React.RefObject<boolean>
}

function useSidebarRailPointerHandlers(
  props: React.ComponentProps<'button'>,
  resolvedResizable: SidebarResolvedResizableOptions | null,
  side: 'left' | 'right',
  open: boolean,
  refs: SidebarRailRefs
) {
  const { onPointerCancel, onPointerDown, onPointerMove, onPointerUp } = props
  const { resizeStateRef, suppressClickRef } = refs

  const endResizeInteraction = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current
      if (!resizeState || resizeState.pointerId !== event.pointerId) return

      event.preventDefault()
      suppressClickRef.current = resizeState.moved
      stopResize({ pointerId: event.pointerId, resizeStateRef, resolvedResizable })
    },
    [resizeStateRef, resolvedResizable, suppressClickRef]
  )

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event)
      if (event.defaultPrevented || !resolvedResizable || !open || event.button !== 0) return
      const resizeState = createResizeState({ event, resolvedResizable, side })
      if (!resizeState) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      resizeStateRef.current = resizeState
      resizeState.wrapper.style.setProperty('--sidebar-width', `${resizeState.width}px`)
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [onPointerDown, open, resizeStateRef, resolvedResizable, side]
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      handleResizePointerMove({ event, onPointerMove, resizeStateRef, resolvedResizable })
    },
    [onPointerMove, resizeStateRef, resolvedResizable]
  )

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerUp?.(event)
      if (event.defaultPrevented) return
      endResizeInteraction(event)
    },
    [endResizeInteraction, onPointerUp]
  )

  const handlePointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerCancel?.(event)
      if (event.defaultPrevented) return
      endResizeInteraction(event)
    },
    [endResizeInteraction, onPointerCancel]
  )

  return { handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp }
}

function useSidebarRailClickHandler(
  onClick: React.ComponentProps<'button'>['onClick'],
  resolvedResizable: SidebarResolvedResizableOptions | null,
  open: boolean,
  toggleSidebar: () => void,
  suppressClickRef: React.RefObject<boolean>
) {
  return React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        event.preventDefault()
        return
      }
      if (resolvedResizable && open) {
        event.preventDefault()
        return
      }
      toggleSidebar()
    },
    [onClick, open, resolvedResizable, suppressClickRef, toggleSidebar]
  )
}

function useSidebarRailHandlers(
  props: React.ComponentProps<'button'>,
  resolvedResizable: SidebarResolvedResizableOptions | null,
  side: 'left' | 'right',
  open: boolean,
  toggleSidebar: () => void
) {
  const railRef = React.useRef<HTMLButtonElement | null>(null)
  const suppressClickRef = React.useRef(false)
  const resizeStateRef = React.useRef<ResizeState | null>(null)
  useSidebarResizeLifecycle(railRef, resizeStateRef, resolvedResizable)

  const pointerHandlers = useSidebarRailPointerHandlers(props, resolvedResizable, side, open, {
    railRef,
    resizeStateRef,
    suppressClickRef,
  })

  const handleClick = useSidebarRailClickHandler(
    props.onClick,
    resolvedResizable,
    open,
    toggleSidebar,
    suppressClickRef
  )

  return { ...pointerHandlers, handleClick, railRef }
}

export function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { open, toggleSidebar } = useSidebar()
  const sidebarInstance = React.useContext(SidebarInstanceContext)
  const resolvedResizable = sidebarInstance?.resizable ?? null
  const canResize = resolvedResizable !== null && open
  const railLabel = canResize ? 'Resize Sidebar' : 'Toggle Sidebar'
  const railTitle = canResize ? 'Drag to resize sidebar' : 'Toggle Sidebar'
  const {
    handleClick,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    railRef,
  } = useSidebarRailHandlers(
    props,
    resolvedResizable,
    sidebarInstance?.side ?? 'left',
    open,
    toggleSidebar
  )

  return (
    <button
      aria-label={railLabel}
      className={cn(
        '-translate-x-1/2 group-data-[side=left]:-right-4 absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=right]:left-0 sm:flex [[data-collapsible=offcanvas][data-state=collapsed]_&]:pointer-events-none',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'group-data-[collapsible=offcanvas]:translate-x-0 hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:after:left-full',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className
      )}
      data-sidebar="rail"
      data-slot="sidebar-rail"
      onClick={handleClick}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={railRef}
      tabIndex={-1}
      title={railTitle}
      type="button"
      {...props}
    />
  )
}
