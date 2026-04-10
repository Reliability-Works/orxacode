import { type ThreadId } from '@orxa-code/contracts'
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import * as Schema from 'effect/Schema'

import ChatView from '../components/ChatView'
import { ChatSplitPaneContext, type ChatSplitPane } from '../components/chat/ChatSplitPaneContext'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { SidebarInset } from '~/components/ui/sidebar'
const CHAT_SPLIT_RATIO_STORAGE_KEY = 'orxa:chat-split-ratio'
const CHAT_SPLIT_DEFAULT_RATIO = 0.5
const CHAT_SPLIT_MIN_RATIO = 0.28
const CHAT_SPLIT_MAX_RATIO = 0.72
const ChatSplitRatioSchema = Schema.Number

function SplitAwareChatThreadShell(props: {
  threadId: ThreadId
  pane: ChatSplitPane
  splitOpen: boolean
  showHeader: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  const {
    focusedPane,
    maximizedPane,
    onFocusPane,
    onToggleMaximize,
    onToggleSplit,
    pane,
    showHeader,
    splitOpen,
    threadId,
  } = props
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
        <ChatView key={threadId} threadId={threadId} showHeader={showHeader} />
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
          Math.max(
            CHAT_SPLIT_MIN_RATIO,
            Math.min(CHAT_SPLIT_MAX_RATIO, (clientX - rect.left) / rect.width)
          )
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
  showHeader: boolean
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
      style={{
        flexBasis: props.basis,
        flexGrow: props.pane === 'primary' ? 0 : 1,
        flexShrink: props.pane === 'primary' ? 0 : 1,
      }}
      onPointerDown={() => props.onFocusPane(props.pane)}
    >
      <SplitAwareChatThreadShell
        threadId={props.threadId}
        pane={props.pane}
        showHeader={props.showHeader}
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
        showHeader
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
        showHeader
        basis={primaryBasis}
        focusedPane={props.focusedPane}
        maximizedPane={props.maximizedPane}
        onToggleSplit={props.onToggleSplit}
        onFocusPane={props.onFocusPane}
        onToggleMaximize={props.onToggleMaximize}
      />
      {!primaryHidden && !secondaryHidden ? (
        <div
          className="relative z-10 w-2 shrink-0 cursor-col-resize touch-none bg-transparent"
          onPointerDown={handleResizePointerDown}
          aria-hidden="true"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
        </div>
      ) : null}
      <SplitThreadPane
        hidden={secondaryHidden}
        pane="secondary"
        threadId={props.secondaryThreadId}
        showHeader={false}
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
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  return (
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
  )
}

export function ChatThreadSheetLayout(props: {
  threadId: ThreadId
  secondaryThreadId: ThreadId | null
  splitOpen: boolean
  focusedPane: ChatSplitPane
  maximizedPane: ChatSplitPane | null
  onToggleSplit: () => void
  onFocusPane: (pane: ChatSplitPane) => void
  onToggleMaximize: (pane: ChatSplitPane) => void
}) {
  return (
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
  )
}
