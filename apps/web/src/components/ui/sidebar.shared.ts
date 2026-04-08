import * as React from 'react'

export const SIDEBAR_COOKIE_NAME = 'sidebar_state'
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
export const SIDEBAR_WIDTH = '16rem'
export const SIDEBAR_WIDTH_MOBILE = 'calc(100vw - var(--spacing(3)))'
export const SIDEBAR_WIDTH_ICON = '3rem'
export const SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH = 16 * 16

export type SidebarContextProps = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

export type SidebarResizeContext = {
  currentWidth: number
  nextWidth: number
  rail: HTMLButtonElement
  side: 'left' | 'right'
  sidebarRoot: HTMLElement
  wrapper: HTMLElement
}

export type SidebarResizableOptions = {
  maxWidth?: number
  minWidth?: number
  onResize?: (width: number) => void
  shouldAcceptWidth?: (context: SidebarResizeContext) => boolean
  storageKey?: string
}

export type SidebarResolvedResizableOptions = {
  maxWidth: number
  minWidth: number
  onResize?: (width: number) => void
  shouldAcceptWidth?: (context: SidebarResizeContext) => boolean
  storageKey: string | null
}

export type SidebarInstanceContextProps = {
  resizable: SidebarResolvedResizableOptions | null
  side: 'left' | 'right'
}

export const SidebarContext = React.createContext<SidebarContextProps | null>(null)
export const SidebarInstanceContext = React.createContext<SidebarInstanceContextProps | null>(null)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }

  return context
}

export function clampSidebarWidth(width: number, options: SidebarResolvedResizableOptions): number {
  return Math.max(options.minWidth, Math.min(width, options.maxWidth))
}
