import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { PanelLeftCloseIcon, PanelLeftIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from '~/components/ui/sheet'
import { useIsMobile } from '~/hooks/useMediaQuery'
import {
  SIDEBAR_COOKIE_MAX_AGE,
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_ICON,
  SIDEBAR_WIDTH_MOBILE,
  SidebarContext,
  SidebarInstanceContext,
  type SidebarContextProps,
  type SidebarInstanceContextProps,
  type SidebarResizableOptions,
  type SidebarResolvedResizableOptions,
  useSidebar,
} from './sidebar.shared'
import { SidebarRail } from './sidebar.rail'
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './sidebar.menu'

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    async (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      await cookieStore.set({
        expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
        name: SIDEBAR_COOKIE_NAME,
        path: '/',
        value: String(openState),
      })
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile(open => !open) : setOpen(open => !open)
  }, [isMobile, setOpen])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn(
          'group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar',
          className
        )}
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  resizable = false,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  resizable?: boolean | SidebarResizableOptions
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
  const resolvedResizable = React.useMemo<SidebarResolvedResizableOptions | null>(() => {
    if (isMobile || collapsible === 'none' || !resizable) {
      return null
    }

    const options = typeof resizable === 'boolean' ? {} : resizable
    return {
      maxWidth: options.maxWidth ?? Number.POSITIVE_INFINITY,
      minWidth: options.minWidth ?? SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH,
      storageKey: options.storageKey ?? null,
      ...(options.onResize ? { onResize: options.onResize } : {}),
      ...(options.shouldAcceptWidth ? { shouldAcceptWidth: options.shouldAcceptWidth } : {}),
    }
  }, [collapsible, isMobile, resizable])
  const instanceContextValue = React.useMemo<SidebarInstanceContextProps>(
    () => ({ side, resizable: resolvedResizable }),
    [resolvedResizable, side]
  )

  if (collapsible === 'none') {
    return renderStaticSidebar(instanceContextValue, children, className, props)
  }

  if (isMobile) {
    return renderMobileSidebar({
      children,
      className,
      instanceContextValue,
      openMobile,
      props,
      setOpenMobile,
      side,
    })
  }

  return renderDesktopSidebar({
    children,
    className,
    collapsible,
    instanceContextValue,
    props,
    side,
    state,
    variant,
  })
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, openMobile } = useSidebar()

  return (
    <Button
      className={cn('size-7', className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={event => {
        onClick?.(event)
        toggleSidebar()
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      {openMobile ? <PanelLeftCloseIcon /> : <PanelLeftIcon />}
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      className={cn(
        'relative flex min-w-0 w-full flex-1 flex-col bg-background',
        'md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5',
        className
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  )
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn('h-8 w-full bg-background shadow-none', className)}
      data-sidebar="input"
      data-slot="sidebar-input"
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 p-2', className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 p-2', className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  )
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn('mx-2 w-auto bg-sidebar-border', className)}
      data-sidebar="separator"
      data-slot="sidebar-separator"
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <ScrollArea hideScrollbars scrollFade className="h-auto min-h-0 flex-1">
      <div
        className={cn(
          'flex w-full min-w-0 flex-col gap-2 group-data-[collapsible=icon]:overflow-hidden',
          className
        )}
        data-sidebar="content"
        data-slot="sidebar-content"
        {...props}
      />
    </ScrollArea>
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  )
}

function SidebarGroupLabel({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  const defaultProps = {
    className: cn(
      'flex h-8 shrink-0 items-center rounded-lg px-2 font-medium text-sidebar-foreground text-xs outline-hidden ring-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
      'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
      className
    ),
    'data-sidebar': 'group-label',
    'data-slot': 'sidebar-group-label',
  }

  return useRender({
    defaultTagName: 'div',
    props: mergeProps(defaultProps, props),
    render,
  })
}

function SidebarGroupAction({ className, render, ...props }: useRender.ComponentProps<'button'>) {
  const defaultProps = {
    className: cn(
      "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      // Increases the hit area of the button on mobile.
      'after:-inset-2 after:absolute md:after:hidden',
      'group-data-[collapsible=icon]:hidden',
      className
    ),
    'data-sidebar': 'group-action',
    'data-slot': 'sidebar-group-action',
  }

  return useRender({
    defaultTagName: 'button',
    props: mergeProps(defaultProps, props),
    render,
  })
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('w-full text-sm', className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  )
}

function renderStaticSidebar(
  instanceContextValue: SidebarInstanceContextProps,
  children: React.ReactNode,
  className: string | undefined,
  props: React.ComponentProps<'div'>
) {
  return (
    <SidebarInstanceContext.Provider value={instanceContextValue}>
      <div
        className={cn(
          'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground',
          className
        )}
        data-slot="sidebar"
        {...props}
      >
        {children}
      </div>
    </SidebarInstanceContext.Provider>
  )
}

function renderMobileSidebar(input: {
  children: React.ReactNode
  className: string | undefined
  instanceContextValue: SidebarInstanceContextProps
  openMobile: boolean
  props: React.ComponentProps<'div'>
  setOpenMobile: (open: boolean) => void
  side: 'left' | 'right'
}) {
  return (
    <SidebarInstanceContext.Provider value={input.instanceContextValue}>
      <Sheet onOpenChange={input.setOpenMobile} open={input.openMobile} {...input.props}>
        <SheetPopup
          className={cn(
            'w-(--sidebar-width) max-w-none bg-sidebar p-0 text-sidebar-foreground',
            input.className
          )}
          data-mobile="true"
          data-sidebar="sidebar"
          data-slot="sidebar"
          showCloseButton={false}
          side={input.side}
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{input.children}</div>
        </SheetPopup>
      </Sheet>
    </SidebarInstanceContext.Provider>
  )
}

function renderDesktopSidebar(input: {
  children: React.ReactNode
  className: string | undefined
  collapsible: 'offcanvas' | 'icon' | 'none'
  instanceContextValue: SidebarInstanceContextProps
  props: React.ComponentProps<'div'>
  side: 'left' | 'right'
  state: 'expanded' | 'collapsed'
  variant: 'sidebar' | 'floating' | 'inset'
}) {
  return (
    <SidebarInstanceContext.Provider value={input.instanceContextValue}>
      <div
        className="group peer hidden text-sidebar-foreground md:block"
        data-collapsible={input.state === 'collapsed' ? input.collapsible : ''}
        data-side={input.side}
        data-slot="sidebar"
        data-state={input.state}
        data-variant={input.variant}
      >
        <div
          className={cn(
            'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear',
            'group-data-[collapsible=offcanvas]:w-0',
            'group-data-[side=right]:rotate-180',
            input.variant === 'floating' || input.variant === 'inset'
              ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]'
              : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)'
          )}
          data-slot="sidebar-gap"
        />
        <div
          className={cn(
            'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex',
            input.side === 'left'
              ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
              : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
            input.variant === 'floating' || input.variant === 'inset'
              ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]'
              : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
            input.className
          )}
          data-slot="sidebar-container"
          {...input.props}
        >
          <div
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm/5"
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
          >
            {input.children}
          </div>
        </div>
      </div>
    </SidebarInstanceContext.Provider>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
}
