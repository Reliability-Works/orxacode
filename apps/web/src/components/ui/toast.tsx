'use client'

import { Toast } from '@base-ui/react/toast'
import { useEffect, type ComponentProps, type CSSProperties } from 'react'
import { useParams } from '@tanstack/react-router'
import { ThreadId } from '@orxa-code/contracts'
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'

import { cn } from '~/lib/utils'
import { buttonVariants } from '~/components/ui/buttonVariants'
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard'
import { buildVisibleToastLayout, shouldHideCollapsedToastContent } from './toast.logic'
import { anchoredToastManager, toastManager, type ThreadToastData } from './toastState'
type ToastId = ReturnType<typeof toastManager.add>
type ManagedToast = ComponentProps<typeof Toast.Root>['toast']
const threadToastVisibleTimeoutRemainingMs = new Map<ToastId, number>()

const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: LoaderCircleIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const

function CloseToastButton() {
  return (
    <Toast.Close
      className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
      title="Dismiss"
    >
      <XIcon className="size-3.5" />
    </Toast.Close>
  )
}

function CopyErrorButton({ text }: { text: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard()

  return (
    <button
      className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
      onClick={() => copyToClipboard(text)}
      title="Copy error"
      type="button"
    >
      {isCopied ? (
        <CheckIcon className="size-3.5 text-success" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  )
}

type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
type ToastSwipeDirection = 'up' | 'down' | 'left' | 'right'

interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition
}

function shouldRenderForActiveThread(
  data: ThreadToastData | undefined,
  activeThreadId: ThreadId | null
): boolean {
  const toastThreadId = data?.threadId
  if (!toastThreadId) return true
  return toastThreadId === activeThreadId
}

function useActiveThreadIdFromRoute(): ThreadId | null {
  return useParams({
    strict: false,
    select: params =>
      typeof params.threadId === 'string' ? ThreadId.makeUnsafe(params.threadId) : null,
  })
}

function ThreadToastVisibleAutoDismiss({
  toastId,
  dismissAfterVisibleMs,
}: {
  toastId: ToastId
  dismissAfterVisibleMs: number | undefined
}) {
  useEffect(() => {
    if (!dismissAfterVisibleMs || dismissAfterVisibleMs <= 0) return
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let remainingMs = threadToastVisibleTimeoutRemainingMs.get(toastId) ?? dismissAfterVisibleMs
    let startedAtMs: number | null = null
    let timeoutId: number | null = null
    let closed = false

    const clearTimer = () => {
      if (timeoutId === null) return
      window.clearTimeout(timeoutId)
      timeoutId = null
    }

    const closeToast = () => {
      if (closed) return
      closed = true
      threadToastVisibleTimeoutRemainingMs.delete(toastId)
      toastManager.close(toastId)
    }

    const pause = () => {
      if (startedAtMs === null) return
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAtMs))
      startedAtMs = null
      clearTimer()
      threadToastVisibleTimeoutRemainingMs.set(toastId, remainingMs)
    }

    const start = () => {
      if (closed || startedAtMs !== null) return
      if (remainingMs <= 0) {
        closeToast()
        return
      }
      startedAtMs = Date.now()
      clearTimer()
      timeoutId = window.setTimeout(() => {
        remainingMs = 0
        startedAtMs = null
        closeToast()
      }, remainingMs)
    }

    const syncTimer = () => {
      const shouldRun = document.visibilityState === 'visible' && document.hasFocus()
      if (shouldRun) {
        start()
        return
      }
      pause()
    }

    syncTimer()
    document.addEventListener('visibilitychange', syncTimer)
    window.addEventListener('focus', syncTimer)
    window.addEventListener('blur', syncTimer)

    return () => {
      document.removeEventListener('visibilitychange', syncTimer)
      window.removeEventListener('focus', syncTimer)
      window.removeEventListener('blur', syncTimer)
      pause()
      clearTimer()
    }
  }, [dismissAfterVisibleMs, toastId])

  return null
}

function ToastProvider({ children, position = 'top-right', ...props }: ToastProviderProps) {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts position={position} />
    </Toast.Provider>
  )
}

function toastSwipeDirection(position: ToastPosition, isTop: boolean): ToastSwipeDirection[] {
  const verticalDirection: ToastSwipeDirection = isTop ? 'up' : 'down'
  if (position.includes('center')) {
    return [verticalDirection]
  }
  if (position.includes('left')) {
    return ['left', verticalDirection]
  }
  return ['right', verticalDirection]
}

const TOAST_ICON_CLASS =
  'in-data-[type=loading]:animate-spin in-data-[type=error]:text-destructive in-data-[type=info]:text-info in-data-[type=success]:text-success in-data-[type=warning]:text-warning in-data-[type=loading]:opacity-80'

function ToastIconSlot(props: {
  icon: ((props: { className?: string }) => React.ReactNode) | null
}) {
  if (!props.icon) return null
  return (
    <div
      className="[&>svg]:h-lh [&>svg]:w-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
      data-slot="toast-icon"
    >
      <props.icon className={TOAST_ICON_CLASS} />
    </div>
  )
}

function ToastActionSlot(props: { children?: React.ReactNode }) {
  if (!props.children) return null
  return (
    <Toast.Action
      className={cn(buttonVariants({ size: 'xs' }), 'shrink-0')}
      data-slot="toast-action"
    >
      {props.children}
    </Toast.Action>
  )
}

function ToastBody(props: {
  actionChildren?: React.ReactNode
  hideCollapsedContent?: boolean
  icon: ((props: { className?: string }) => React.ReactNode) | null
  showCompactTitleOnly?: boolean
  showCopyError: boolean
}) {
  if (props.showCompactTitleOnly) {
    return (
      <Toast.Content className="pointer-events-auto px-2 py-1">
        <Toast.Title data-slot="toast-title" />
      </Toast.Content>
    )
  }

  return (
    <Toast.Content
      className={cn(
        'pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm',
        props.hideCollapsedContent &&
          'not-data-expanded:pointer-events-none not-data-expanded:opacity-0'
      )}
    >
      <div className="flex min-w-0 flex-1 gap-2">
        <ToastIconSlot icon={props.icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between gap-1">
            <Toast.Title className="min-w-0 break-words font-medium" data-slot="toast-title" />
          </div>
          <Toast.Description
            className="min-w-0 select-text break-words text-muted-foreground"
            data-slot="toast-description"
          />
        </div>
      </div>
      <ToastActionSlot>{props.actionChildren}</ToastActionSlot>
    </Toast.Content>
  )
}

function StandardToastBody(props: {
  actionChildren?: React.ReactNode
  hideCollapsedContent?: boolean
  icon: (typeof TOAST_ICONS)[keyof typeof TOAST_ICONS] | null
  isErrorWithDescription: boolean
  justifyBetweenTitle: boolean
  showDismiss?: boolean
  description?: string
}) {
  return (
    <Toast.Content
      className={cn(
        'pointer-events-auto flex items-center justify-between gap-1.5 overflow-hidden px-3.5 py-3 text-sm transition-opacity duration-250 data-expanded:opacity-100',
        props.hideCollapsedContent &&
          'not-data-expanded:pointer-events-none not-data-expanded:opacity-0'
      )}
    >
      <div className="flex min-w-0 flex-1 gap-2">
        <ToastIconSlot icon={props.icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            className={cn(
              'flex items-center gap-1',
              props.justifyBetweenTitle && 'justify-between'
            )}
          >
            <Toast.Title className="min-w-0 break-words font-medium" data-slot="toast-title" />
            <div className="flex shrink-0 items-center gap-0.5">
              {props.isErrorWithDescription && props.description && (
                <CopyErrorButton text={props.description} />
              )}
              {props.showDismiss && <CloseToastButton />}
            </div>
          </div>
          <Toast.Description
            className="min-w-0 select-text break-words text-muted-foreground"
            data-slot="toast-description"
          />
        </div>
      </div>
      <ToastActionSlot>{props.actionChildren}</ToastActionSlot>
    </Toast.Content>
  )
}

const VIEWPORT_TOAST_ITEM_CLASSES = [
  'absolute z-[calc(9999-var(--toast-index))] h-(--toast-calc-height) w-full select-none rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
  'data-[position*=right]:right-0 data-[position*=right]:left-auto',
  'data-[position*=left]:right-auto data-[position*=left]:left-0',
  'data-[position*=center]:right-0 data-[position*=center]:left-0',
  'data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top',
  'data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom',
  'after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full',
  'data-[position*=top]:after:top-full',
  'data-[position*=bottom]:after:bottom-full',
  '[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]',
  'data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]',
  'data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]',
  'data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]',
  'data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]',
  'data-limited:opacity-0',
  'data-expanded:h-(--toast-height)',
  'data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]',
  'data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]',
  'data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]',
  'data-[position*=top]:data-[position*=right]:data-starting-style:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-ending-style:opacity-0',
  'data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]',
  'data-[position*=top]:data-[position*=right]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]',
  'data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]',
  'data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]',
  'data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]',
  'data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]',
] as const

function ViewportToastItem(props: {
  isTop: boolean
  offsetY: number
  position: ToastPosition
  toast: ManagedToast
  visibleIndex: number
  visibleToastCount: number
}) {
  const Icon = props.toast.type ? TOAST_ICONS[props.toast.type as keyof typeof TOAST_ICONS] : null
  const hideCollapsedContent = shouldHideCollapsedToastContent(
    props.visibleIndex,
    props.visibleToastCount
  )

  return (
    <Toast.Root
      className={cn(VIEWPORT_TOAST_ITEM_CLASSES)}
      data-position={props.position}
      key={props.toast.id}
      style={
        {
          '--toast-index': props.visibleIndex,
          '--toast-offset-y': `${props.offsetY}px`,
        } as CSSProperties
      }
      swipeDirection={toastSwipeDirection(props.position, props.isTop)}
      toast={props.toast}
    >
      <ThreadToastVisibleAutoDismiss
        dismissAfterVisibleMs={props.toast.data?.dismissAfterVisibleMs}
        toastId={props.toast.id}
      />
      <StandardToastBody
        actionChildren={props.toast.actionProps?.children}
        hideCollapsedContent={hideCollapsedContent}
        icon={Icon}
        isErrorWithDescription={
          props.toast.type === 'error' && typeof props.toast.description === 'string'
        }
        justifyBetweenTitle
        showDismiss={!props.toast.data?.dismissAfterVisibleMs}
        {...(typeof props.toast.description === 'string'
          ? { description: props.toast.description }
          : {})}
      />
    </Toast.Root>
  )
}

function Toasts({ position = 'top-right' }: { position: ToastPosition }) {
  const { toasts } = Toast.useToastManager<ThreadToastData>()
  const activeThreadId = useActiveThreadIdFromRoute()
  const isTop = position.startsWith('top')
  const visibleToasts = toasts.filter(toast =>
    shouldRenderForActiveThread(toast.data, activeThreadId)
  )
  const visibleToastLayout = buildVisibleToastLayout(visibleToasts)

  useEffect(() => {
    const activeToastIds = new Set(toasts.map(toast => toast.id))
    for (const toastId of threadToastVisibleTimeoutRemainingMs.keys()) {
      if (!activeToastIds.has(toastId)) {
        threadToastVisibleTimeoutRemainingMs.delete(toastId)
      }
    }
  }, [toasts])

  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        className={cn(
          'fixed z-50 mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 [--toast-header-offset:52px] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]',
          // Vertical positioning
          'data-[position*=top]:top-[calc(var(--toast-inset)+var(--toast-header-offset))]',
          'data-[position*=bottom]:bottom-(--toast-inset)',
          // Horizontal positioning
          'data-[position*=left]:left-(--toast-inset)',
          'data-[position*=right]:right-(--toast-inset)',
          'data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2'
        )}
        data-position={position}
        data-slot="toast-viewport"
        style={
          {
            '--toast-frontmost-height': `${visibleToastLayout.frontmostHeight}px`,
          } as CSSProperties
        }
      >
        {visibleToastLayout.items.map(({ toast, visibleIndex, offsetY }) => (
          <ViewportToastItem
            isTop={isTop}
            key={toast.id}
            offsetY={offsetY}
            position={position}
            toast={toast}
            visibleIndex={visibleIndex}
            visibleToastCount={visibleToastLayout.items.length}
          />
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

function AnchoredToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <AnchoredToasts />
    </Toast.Provider>
  )
}

function AnchoredToasts() {
  const { toasts } = Toast.useToastManager<ThreadToastData>()
  const activeThreadId = useActiveThreadIdFromRoute()
  const visibleToasts = toasts.filter(toast =>
    shouldRenderForActiveThread(toast.data, activeThreadId)
  )

  return (
    <Toast.Portal data-slot="toast-portal-anchored">
      <Toast.Viewport className="outline-none" data-slot="toast-viewport-anchored">
        {visibleToasts.map(toast => {
          const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null
          const tooltipStyle = toast.data?.tooltipStyle ?? false
          const positionerProps = toast.positionerProps

          if (!positionerProps?.anchor) {
            return null
          }

          return (
            <Toast.Positioner
              className="z-50 max-w-[min(--spacing(64),var(--available-width))]"
              data-slot="toast-positioner"
              key={toast.id}
              sideOffset={positionerProps.sideOffset ?? 4}
              toast={toast}
            >
              <Toast.Root
                className={cn(
                  'relative text-balance border bg-popover not-dark:bg-clip-padding text-popover-foreground text-xs transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
                  tooltipStyle
                    ? 'rounded-md shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]'
                    : 'rounded-lg shadow-lg/5 before:rounded-[calc(var(--radius-lg)-1px)]'
                )}
                data-slot="toast-popup"
                toast={toast}
              >
                {tooltipStyle ? (
                  <ToastBody icon={null} showCompactTitleOnly showCopyError={false} />
                ) : (
                  <StandardToastBody
                    actionChildren={toast.actionProps?.children}
                    icon={Icon}
                    isErrorWithDescription={
                      toast.type === 'error' && typeof toast.description === 'string'
                    }
                    justifyBetweenTitle={false}
                    {...(typeof toast.description === 'string'
                      ? { description: toast.description }
                      : {})}
                  />
                )}
              </Toast.Root>
            </Toast.Positioner>
          )
        })}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export { ToastProvider, type ToastPosition, AnchoredToastProvider }
