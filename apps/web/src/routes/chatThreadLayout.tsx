import { type ThreadId } from '@orxa-code/contracts'
import { Suspense, lazy, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useCallback, useMemo, useRef } from 'react'
import * as Schema from 'effect/Schema'

import ChatView from '../components/ChatView'
import { ChatSplitPaneContext, type ChatSplitPane } from '../components/chat/ChatSplitPaneContext'
import { DiffWorkerPoolProvider } from '../components/DiffWorkerPoolProvider'
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from '../components/DiffPanelShell'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { Sheet, SheetPopup } from '../components/ui/sheet'
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from '~/components/ui/sidebar'

const DiffPanel = lazy(() => import('../components/DiffPanel'))
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = 'chat_diff_sidebar_width'
const DIFF_INLINE_DEFAULT_WIDTH = 'clamp(28rem,48vw,44rem)'
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208
const CHAT_SPLIT_RATIO_STORAGE_KEY = 'orxa:chat-split-ratio'
const CHAT_SPLIT_DEFAULT_RATIO = 0.5
const CHAT_SPLIT_MIN_RATIO = 0.28
const CHAT_SPLIT_MAX_RATIO = 0.72
const ChatSplitRatioSchema = Schema.Number

function shouldAcceptInlineSidebarWidth(input: { nextWidth: number; wrapper: HTMLElement }) {
  const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']")
  if (!composerForm) return true
  const composerViewport = composerForm.parentElement
  if (!composerViewport) return true
  const previousSidebarWidth = input.wrapper.style.getPropertyValue('--sidebar-width')
  input.wrapper.style.setProperty('--sidebar-width', `${input.nextWidth}px`)

  const viewportStyle = window.getComputedStyle(composerViewport)
  const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0
  const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0
  const viewportContentWidth = Math.max(
    0,
    composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight
  )
  const formRect = composerForm.getBoundingClientRect()
  const composerFooter = composerForm.querySelector<HTMLElement>("[data-chat-composer-footer='true']")
  const composerRightActions = composerForm.querySelector<HTMLElement>("[data-chat-composer-actions='right']")
  const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0
  const composerFooterGap = composerFooter
    ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
      Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
      0
    : 0
  const minimumComposerWidth =
    COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap
  const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5
  const overflowsViewport = formRect.width > viewportContentWidth + 0.5
  const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth

  if (previousSidebarWidth.length > 0) {
    input.wrapper.style.setProperty('--sidebar-width', previousSidebarWidth)
  } else {
    input.wrapper.style.removeProperty('--sidebar-width')
  }
  return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth
}

function DiffPanelSheet(props: { children: ReactNode; diffOpen: boolean; onCloseDiff: () => void }) {
  return (
    <Sheet open={props.diffOpen} onOpenChange={open => !open && props.onCloseDiff()}>
      <SheetPopup side="right" showCloseButton={false} keepMounted className="w-[min(88vw,820px)] max-w-[820px] p-0">
        {props.children}
      </SheetPopup>
    </Sheet>
  )
}

function LazyDiffPanel(props: { mode: DiffPanelMode }) {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
            <DiffPanelLoadingState label="Loading diff viewer..." />
          </DiffPanelShell>
        }
      >
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  )
}

function DiffPanelInlineSidebar(props: {
  diffOpen: boolean
  onCloseDiff: () => void
  onOpenDiff: () => void
  renderDiffContent: boolean
}) {
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        props.onOpenDiff()
        return
      }
      props.onCloseDiff()
    },
    [props]
  )

  return (
    <SidebarProvider
      defaultOpen={false}
      open={props.diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ '--sidebar-width': DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {props.renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  )
}

function SplitAwareChatThreadShell(props: {
  threadId: ThreadId
  pane: ChatSplitPane
  splitOpen: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  const { focusedPane, maximizedPane, onFocusPane, onToggleMaximize, onToggleSplit, pane, splitOpen, threadId } =
    props
  const controls = useMemo(
    () => ({
      pane,
      splitOpen,
      focusedPane,
      maximizedPane,
      toggleSplit: onToggleSplit,
      focusPane: () => onFocusPane(pane),
      toggleMaximize: () => onToggleMaximize(pane),
    }),
    [focusedPane, maximizedPane, onFocusPane, onToggleMaximize, onToggleSplit, pane, splitOpen]
  )

  return (
    <ChatSplitPaneContext.Provider value={controls}>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView key={threadId} threadId={threadId} />
      </SidebarInset>
    </ChatSplitPaneContext.Provider>
  )
}

function useSplitResizeHandle(
  layoutRef: RefObject<HTMLDivElement | null>,
  setSplitRatio: (value: number) => void
) {
  return useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = layoutRef.current
      if (!root) return
      event.preventDefault()
      const pointerId = event.pointerId
      const target = event.currentTarget
      const updateRatio = (clientX: number) => {
        const rect = root.getBoundingClientRect()
        if (rect.width <= 0) return
        setSplitRatio(
          Math.max(CHAT_SPLIT_MIN_RATIO, Math.min(CHAT_SPLIT_MAX_RATIO, (clientX - rect.left) / rect.width))
        )
      }
      target.setPointerCapture(pointerId)
      updateRatio(event.clientX)
      const onPointerMove = (moveEvent: PointerEvent) => updateRatio(moveEvent.clientX)
      const onPointerEnd = () => {
        target.releasePointerCapture(pointerId)
        target.removeEventListener('pointermove', onPointerMove)
        target.removeEventListener('pointerup', onPointerEnd)
        target.removeEventListener('pointercancel', onPointerEnd)
      }
      target.addEventListener('pointermove', onPointerMove)
      target.addEventListener('pointerup', onPointerEnd)
      target.addEventListener('pointercancel', onPointerEnd)
    },
    [layoutRef, setSplitRatio]
  )
}

function SplitThreadPane(props: {
  hidden: boolean
  pane: ChatSplitPane
  threadId: ThreadId | null
  basis: string
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  if (props.hidden || props.threadId === null) return null
  return (
    <div
      className={props.pane === 'primary' ? 'min-h-0 min-w-0' : 'min-h-0 min-w-0 flex-1'}
      style={{ flexBasis: props.basis, flexGrow: props.pane === 'primary' ? 0 : 1, flexShrink: props.pane === 'primary' ? 0 : 1 }}
      onPointerDown={() => props.onFocusPane(props.pane)}
    >
      <SplitAwareChatThreadShell
        threadId={props.threadId}
        pane={props.pane}
        splitOpen
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
    </div>
  )
}

function ChatSplitInlineLayout(props: {
  primaryThreadId: ThreadId
  secondaryThreadId: ThreadId | null
  splitOpen: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [splitRatio, setSplitRatio] = useLocalStorage(
    CHAT_SPLIT_RATIO_STORAGE_KEY,
    CHAT_SPLIT_DEFAULT_RATIO,
    ChatSplitRatioSchema
  )
  const handleResizePointerDown = useSplitResizeHandle(layoutRef, setSplitRatio)

  if (!props.splitOpen || !props.secondaryThreadId) {
    return (
      <SplitAwareChatThreadShell
        threadId={props.primaryThreadId}
        pane="primary"
        splitOpen={false}
        focusedPane="primary"
        maximizedPane={null}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
    )
  }

  const primaryHidden = props.maximizedPane === 'secondary'
  const secondaryHidden = props.maximizedPane === 'primary'
  const primaryBasis = secondaryHidden ? '100%' : `${splitRatio * 100}%`
  const secondaryBasis = primaryHidden ? '100%' : `${(1 - splitRatio) * 100}%`

  return (
    <div ref={layoutRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <SplitThreadPane
        hidden={primaryHidden}
        pane="primary"
        threadId={props.primaryThreadId}
        basis={primaryBasis}
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
      {!primaryHidden && !secondaryHidden ? (
        <div className="relative z-10 w-2 shrink-0 cursor-col-resize touch-none bg-transparent" onPointerDown={handleResizePointerDown} aria-hidden="true">
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
        </div>
      ) : null}
      <SplitThreadPane
        hidden={secondaryHidden}
        pane="secondary"
        threadId={props.secondaryThreadId}
        basis={secondaryBasis}
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
    </div>
  )
}

export function ChatThreadInlineLayout(props: {
  threadId: ThreadId
  secondaryThreadId: ThreadId | null
  splitOpen: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  diffOpen: boolean
  onCloseDiff: () => void
  onOpenDiff: () => void
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
  renderDiffContent: boolean
}) {
  return (
    <>
      <ChatSplitInlineLayout
        primaryThreadId={props.threadId}
        secondaryThreadId={props.secondaryThreadId}
        splitOpen={props.splitOpen}
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
      {props.renderDiffContent ? (
        <DiffPanelInlineSidebar
          diffOpen={props.diffOpen}
          onCloseDiff={props.onCloseDiff}
          onOpenDiff={props.onOpenDiff}
          renderDiffContent
        />
      ) : null}
    </>
  )
}

export function ChatThreadSheetLayout(props: {
  threadId: ThreadId
  secondaryThreadId: ThreadId | null
  splitOpen: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  diffOpen: boolean
  onCloseDiff: () => void
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
  renderDiffContent: boolean
}) {
  return (
    <>
      <ChatSplitInlineLayout
        primaryThreadId={props.threadId}
        secondaryThreadId={props.secondaryThreadId}
        splitOpen={props.splitOpen}
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
      <DiffPanelSheet diffOpen={props.diffOpen} onCloseDiff={props.onCloseDiff}>
        {props.renderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </DiffPanelSheet>
    </>
  )
}
