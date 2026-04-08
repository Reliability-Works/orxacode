import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isScrollContainerNearBottom } from '../../chat-scroll'
import { useComposerLayoutObserver } from './useChatScrollBehavior.layout'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollRefs {
  messagesScrollRef: React.MutableRefObject<HTMLDivElement | null>
  shouldAutoScrollRef: React.MutableRefObject<boolean>
  lastKnownScrollTopRef: React.MutableRefObject<number>
  isPointerScrollActiveRef: React.MutableRefObject<boolean>
  lastTouchClientYRef: React.MutableRefObject<number | null>
  pendingUserScrollUpIntentRef: React.MutableRefObject<boolean>
  pendingAutoScrollFrameRef: React.MutableRefObject<number | null>
  pendingInteractionAnchorRef: React.MutableRefObject<{ element: HTMLElement; top: number } | null>
  pendingInteractionAnchorFrameRef: React.MutableRefObject<number | null>
  composerFormRef: React.MutableRefObject<HTMLFormElement | null>
  composerFormHeightRef: React.MutableRefObject<number>
  composerFooterRef: React.MutableRefObject<HTMLDivElement | null>
  composerFooterLeadingRef: React.MutableRefObject<HTMLDivElement | null>
  composerFooterActionsRef: React.MutableRefObject<HTMLDivElement | null>
}

interface MessagesEventHandlers {
  onMessagesScroll: () => void
  onMessagesClickCapture: (e: React.MouseEvent<HTMLDivElement>) => void
  onMessagesWheel: (e: React.WheelEvent<HTMLDivElement>) => void
  onMessagesPointerDown: () => void
  onMessagesPointerUp: () => void
  onMessagesPointerCancel: () => void
  onMessagesTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void
  onMessagesTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  onMessagesTouchEnd: () => void
}

export interface ChatScrollBehavior extends MessagesEventHandlers {
  refs: ScrollRefs
  showScrollToBottom: boolean
  messagesScrollElement: HTMLDivElement | null
  isComposerFooterCompact: boolean
  isComposerPrimaryActionsCompact: boolean
  setMessagesScrollContainerRef: (el: HTMLDivElement | null) => void
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void
  forceStickToBottom: () => void
  scheduleStickToBottom: () => void
}

export interface ChatScrollInput {
  activeThreadId: string | null
  messageCount: number
  phase: string
  timelineEntriesLength: number
  composerFooterActionLayoutKey: string
  composerFooterHasWideActions: boolean
}

// ---------------------------------------------------------------------------
// Main hook — delegates to focused sub-hooks for state, handlers, and effects
// ---------------------------------------------------------------------------

export function useChatScrollBehavior(input: ChatScrollInput): ChatScrollBehavior {
  const refs = useScrollRefs()
  const state = useScrollDisplayState(refs.messagesScrollRef)
  const handlers = useScrollHandlers(refs, state.setShowScrollToBottom)
  useScrollEffects(refs, handlers, input)
  useComposerLayoutObserver(
    refs,
    handlers.scheduleStickToBottom,
    input,
    state.setIsComposerFooterCompact,
    state.setIsComposerPrimaryActionsCompact
  )

  return {
    refs,
    showScrollToBottom: state.showScrollToBottom,
    messagesScrollElement: state.messagesScrollElement,
    isComposerFooterCompact: state.isComposerFooterCompact,
    isComposerPrimaryActionsCompact: state.isComposerPrimaryActionsCompact,
    setMessagesScrollContainerRef: state.setMessagesScrollContainerRef,
    scrollMessagesToBottom: handlers.scrollMessagesToBottom,
    forceStickToBottom: handlers.forceStickToBottom,
    scheduleStickToBottom: handlers.scheduleStickToBottom,
    onMessagesScroll: handlers.onMessagesScroll,
    onMessagesClickCapture: handlers.onMessagesClickCapture,
    onMessagesWheel: handlers.onMessagesWheel,
    onMessagesPointerDown: handlers.onMessagesPointerDown,
    onMessagesPointerUp: handlers.onMessagesPointerUp,
    onMessagesPointerCancel: handlers.onMessagesPointerCancel,
    onMessagesTouchStart: handlers.onMessagesTouchStart,
    onMessagesTouchMove: handlers.onMessagesTouchMove,
    onMessagesTouchEnd: handlers.onMessagesTouchEnd,
  }
}

// ---------------------------------------------------------------------------
// useScrollRefs — owns all scroll/composer DOM refs
// ---------------------------------------------------------------------------

function useScrollRefs(): ScrollRefs {
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const lastKnownScrollTopRef = useRef(0)
  const isPointerScrollActiveRef = useRef(false)
  const lastTouchClientYRef = useRef<number | null>(null)
  const pendingUserScrollUpIntentRef = useRef(false)
  const pendingAutoScrollFrameRef = useRef<number | null>(null)
  const pendingInteractionAnchorRef = useRef<{ element: HTMLElement; top: number } | null>(null)
  const pendingInteractionAnchorFrameRef = useRef<number | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const composerFormHeightRef = useRef(0)
  const composerFooterRef = useRef<HTMLDivElement | null>(null)
  const composerFooterLeadingRef = useRef<HTMLDivElement | null>(null)
  const composerFooterActionsRef = useRef<HTMLDivElement | null>(null)
  return {
    messagesScrollRef,
    shouldAutoScrollRef,
    lastKnownScrollTopRef,
    isPointerScrollActiveRef,
    lastTouchClientYRef,
    pendingUserScrollUpIntentRef,
    pendingAutoScrollFrameRef,
    pendingInteractionAnchorRef,
    pendingInteractionAnchorFrameRef,
    composerFormRef,
    composerFormHeightRef,
    composerFooterRef,
    composerFooterLeadingRef,
    composerFooterActionsRef,
  }
}

// ---------------------------------------------------------------------------
// useScrollDisplayState — reactive state derived from scroll / layout
// ---------------------------------------------------------------------------

interface ScrollDisplayState {
  showScrollToBottom: boolean
  messagesScrollElement: HTMLDivElement | null
  isComposerFooterCompact: boolean
  isComposerPrimaryActionsCompact: boolean
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
  setIsComposerFooterCompact: React.Dispatch<React.SetStateAction<boolean>>
  setIsComposerPrimaryActionsCompact: React.Dispatch<React.SetStateAction<boolean>>
  setMessagesScrollContainerRef: (el: HTMLDivElement | null) => void
}

function useScrollDisplayState(
  messagesScrollRef: React.MutableRefObject<HTMLDivElement | null>
): ScrollDisplayState {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [messagesScrollElement, setMessagesScrollElement] = useState<HTMLDivElement | null>(null)
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false)
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false)

  const setMessagesScrollContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      messagesScrollRef.current = element
      setMessagesScrollElement(element)
    },
    [messagesScrollRef]
  )

  return {
    showScrollToBottom,
    messagesScrollElement,
    isComposerFooterCompact,
    isComposerPrimaryActionsCompact,
    setShowScrollToBottom,
    setIsComposerFooterCompact,
    setIsComposerPrimaryActionsCompact,
    setMessagesScrollContainerRef,
  }
}

// ---------------------------------------------------------------------------
// useScrollHandlers — event handlers for the messages scroll container
// ---------------------------------------------------------------------------

interface ScrollHandlers extends MessagesEventHandlers {
  scrollMessagesToBottom: (behavior?: ScrollBehavior) => void
  cancelPendingStickToBottom: () => void
  cancelPendingInteractionAnchorAdjustment: () => void
  scheduleStickToBottom: () => void
  forceStickToBottom: () => void
}

function useStickToBottomCallbacks(refs: ScrollRefs) {
  const {
    messagesScrollRef,
    shouldAutoScrollRef,
    lastKnownScrollTopRef,
    pendingAutoScrollFrameRef,
    pendingInteractionAnchorFrameRef,
  } = refs

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = messagesScrollRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
      lastKnownScrollTopRef.current = el.scrollTop
      shouldAutoScrollRef.current = true
    },
    [messagesScrollRef, lastKnownScrollTopRef, shouldAutoScrollRef]
  )

  const cancelPendingStickToBottom = useCallback(() => {
    const frame = pendingAutoScrollFrameRef.current
    if (frame === null) return
    pendingAutoScrollFrameRef.current = null
    window.cancelAnimationFrame(frame)
  }, [pendingAutoScrollFrameRef])

  const cancelPendingInteractionAnchorAdjustment = useCallback(() => {
    const frame = pendingInteractionAnchorFrameRef.current
    if (frame === null) return
    pendingInteractionAnchorFrameRef.current = null
    window.cancelAnimationFrame(frame)
  }, [pendingInteractionAnchorFrameRef])

  const scheduleStickToBottom = useCallback(() => {
    if (pendingAutoScrollFrameRef.current !== null) return
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      scrollMessagesToBottom()
    })
  }, [pendingAutoScrollFrameRef, scrollMessagesToBottom])

  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom()
    scrollMessagesToBottom()
    scheduleStickToBottom()
  }, [cancelPendingStickToBottom, scrollMessagesToBottom, scheduleStickToBottom])

  return {
    scrollMessagesToBottom,
    cancelPendingStickToBottom,
    cancelPendingInteractionAnchorAdjustment,
    scheduleStickToBottom,
    forceStickToBottom,
  }
}

function useScrollHandlers(
  refs: ScrollRefs,
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
): ScrollHandlers {
  const {
    messagesScrollRef,
    shouldAutoScrollRef,
    lastKnownScrollTopRef,
    isPointerScrollActiveRef,
    lastTouchClientYRef,
    pendingUserScrollUpIntentRef,
    pendingInteractionAnchorRef,
    pendingInteractionAnchorFrameRef,
  } = refs

  const stick = useStickToBottomCallbacks(refs)
  const {
    scrollMessagesToBottom,
    cancelPendingStickToBottom,
    cancelPendingInteractionAnchorAdjustment,
    scheduleStickToBottom,
    forceStickToBottom,
  } = stick

  const onMessagesScroll = useScrollEventHandler(
    messagesScrollRef,
    shouldAutoScrollRef,
    pendingUserScrollUpIntentRef,
    lastKnownScrollTopRef,
    isPointerScrollActiveRef,
    setShowScrollToBottom
  )

  const onMessagesClickCapture = useScrollClickCaptureHandler(
    messagesScrollRef,
    pendingInteractionAnchorRef,
    pendingInteractionAnchorFrameRef,
    lastKnownScrollTopRef,
    cancelPendingInteractionAnchorAdjustment
  )

  const {
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
  } = useScrollPointerAndTouchHandlers(
    isPointerScrollActiveRef,
    lastTouchClientYRef,
    pendingUserScrollUpIntentRef
  )

  return {
    scrollMessagesToBottom,
    cancelPendingStickToBottom,
    cancelPendingInteractionAnchorAdjustment,
    scheduleStickToBottom,
    forceStickToBottom,
    onMessagesScroll,
    onMessagesClickCapture,
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
  }
}

function useScrollPointerAndTouchHandlers(
  isPointerScrollActiveRef: React.MutableRefObject<boolean>,
  lastTouchClientYRef: React.MutableRefObject<number | null>,
  pendingUserScrollUpIntentRef: React.MutableRefObject<boolean>
) {
  const onMessagesWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0) pendingUserScrollUpIntentRef.current = true
    },
    [pendingUserScrollUpIntentRef]
  )
  const onMessagesPointerDown = useCallback(() => {
    isPointerScrollActiveRef.current = true
  }, [isPointerScrollActiveRef])
  const onMessagesPointerUp = useCallback(() => {
    isPointerScrollActiveRef.current = false
  }, [isPointerScrollActiveRef])
  const onMessagesPointerCancel = useCallback(() => {
    isPointerScrollActiveRef.current = false
  }, [isPointerScrollActiveRef])
  const onMessagesTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      lastTouchClientYRef.current = e.touches[0]?.clientY ?? null
    },
    [lastTouchClientYRef]
  )
  const onMessagesTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0]
      if (!touch) return
      const prev = lastTouchClientYRef.current
      if (prev !== null && touch.clientY > prev + 1) pendingUserScrollUpIntentRef.current = true
      lastTouchClientYRef.current = touch.clientY
    },
    [lastTouchClientYRef, pendingUserScrollUpIntentRef]
  )
  const onMessagesTouchEnd = useCallback(() => {
    lastTouchClientYRef.current = null
  }, [lastTouchClientYRef])
  return {
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
  }
}

// Extracted to keep useScrollHandlers ≤75 lines
function useScrollEventHandler(
  messagesScrollRef: React.MutableRefObject<HTMLDivElement | null>,
  shouldAutoScrollRef: React.MutableRefObject<boolean>,
  pendingUserScrollUpIntentRef: React.MutableRefObject<boolean>,
  lastKnownScrollTopRef: React.MutableRefObject<number>,
  isPointerScrollActiveRef: React.MutableRefObject<boolean>,
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
) {
  return useCallback(() => {
    const el = messagesScrollRef.current
    if (!el) return
    const currentScrollTop = el.scrollTop
    const isNearBottom = isScrollContainerNearBottom(el)
    if (!shouldAutoScrollRef.current && isNearBottom) {
      shouldAutoScrollRef.current = true
      pendingUserScrollUpIntentRef.current = false
    } else if (shouldAutoScrollRef.current && pendingUserScrollUpIntentRef.current) {
      if (currentScrollTop < lastKnownScrollTopRef.current - 1) shouldAutoScrollRef.current = false
      pendingUserScrollUpIntentRef.current = false
    } else if (shouldAutoScrollRef.current && isPointerScrollActiveRef.current) {
      if (currentScrollTop < lastKnownScrollTopRef.current - 1) shouldAutoScrollRef.current = false
    } else if (shouldAutoScrollRef.current && !isNearBottom) {
      if (currentScrollTop < lastKnownScrollTopRef.current - 1) shouldAutoScrollRef.current = false
    }
    setShowScrollToBottom(!shouldAutoScrollRef.current)
    lastKnownScrollTopRef.current = currentScrollTop
  }, [
    messagesScrollRef,
    shouldAutoScrollRef,
    pendingUserScrollUpIntentRef,
    lastKnownScrollTopRef,
    isPointerScrollActiveRef,
    setShowScrollToBottom,
  ])
}

function useScrollClickCaptureHandler(
  messagesScrollRef: React.MutableRefObject<HTMLDivElement | null>,
  pendingInteractionAnchorRef: React.MutableRefObject<{ element: HTMLElement; top: number } | null>,
  pendingInteractionAnchorFrameRef: React.MutableRefObject<number | null>,
  lastKnownScrollTopRef: React.MutableRefObject<number>,
  cancelPendingInteractionAnchorAdjustment: () => void
) {
  return useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const el = messagesScrollRef.current
      if (!el || !(event.target instanceof Element)) return
      const trigger = event.target.closest<HTMLElement>(
        "button, summary, [role='button'], [data-scroll-anchor-target]"
      )
      if (!trigger || !el.contains(trigger) || trigger.closest('[data-scroll-anchor-ignore]'))
        return
      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      }
      cancelPendingInteractionAnchorAdjustment()
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null
        const anchor = pendingInteractionAnchorRef.current
        pendingInteractionAnchorRef.current = null
        const activeEl = messagesScrollRef.current
        if (
          !anchor ||
          !activeEl ||
          !anchor.element.isConnected ||
          !activeEl.contains(anchor.element)
        )
          return
        const delta = anchor.element.getBoundingClientRect().top - anchor.top
        if (Math.abs(delta) < 0.5) return
        activeEl.scrollTop += delta
        lastKnownScrollTopRef.current = activeEl.scrollTop
      })
    },
    [
      messagesScrollRef,
      pendingInteractionAnchorRef,
      pendingInteractionAnchorFrameRef,
      lastKnownScrollTopRef,
      cancelPendingInteractionAnchorAdjustment,
    ]
  )
}

// ---------------------------------------------------------------------------
// useScrollEffects — lifecycle effects for scroll behavior
// ---------------------------------------------------------------------------

function useScrollEffects(
  refs: ScrollRefs,
  handlers: Pick<
    ScrollHandlers,
    | 'cancelPendingStickToBottom'
    | 'cancelPendingInteractionAnchorAdjustment'
    | 'scheduleStickToBottom'
  >,
  input: ChatScrollInput
) {
  const {
    cancelPendingStickToBottom,
    cancelPendingInteractionAnchorAdjustment,
    scheduleStickToBottom,
  } = handlers
  const { shouldAutoScrollRef, messagesScrollRef } = refs

  useEffect(
    () => () => {
      cancelPendingStickToBottom()
      cancelPendingInteractionAnchorAdjustment()
    },
    [cancelPendingInteractionAnchorAdjustment, cancelPendingStickToBottom]
  )

  useLayoutEffect(() => {
    if (!input.activeThreadId) return
    shouldAutoScrollRef.current = true
    scheduleStickToBottom()
    const timeout = window.setTimeout(() => {
      const el = messagesScrollRef.current
      if (!el || isScrollContainerNearBottom(el)) return
      scheduleStickToBottom()
    }, 96)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [input.activeThreadId, scheduleStickToBottom, shouldAutoScrollRef, messagesScrollRef])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    scheduleStickToBottom()
  }, [input.messageCount, scheduleStickToBottom, shouldAutoScrollRef])

  useEffect(() => {
    if (input.phase !== 'running' || !shouldAutoScrollRef.current) return
    scheduleStickToBottom()
  }, [input.phase, scheduleStickToBottom, input.timelineEntriesLength, shouldAutoScrollRef])
}
