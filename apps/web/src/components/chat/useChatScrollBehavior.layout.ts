/**
 * Composer footer layout observer extracted from useChatScrollBehavior.
 */

import { useLayoutEffect } from 'react'
import {
  resolveComposerFooterContentWidth,
  shouldForceCompactComposerFooterForFit,
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerPrimaryActions,
} from '../composerFooterLayout'
import type { ChatScrollInput, ScrollRefs } from './useChatScrollBehavior'

function measureFooterCompactness(
  composerForm: HTMLFormElement,
  composerFooterRef: React.MutableRefObject<HTMLDivElement | null>,
  composerFooterLeadingRef: React.MutableRefObject<HTMLDivElement | null>,
  composerFooterActionsRef: React.MutableRefObject<HTMLDivElement | null>,
  composerFooterHasWideActions: boolean
) {
  const composerFormWidth = composerForm.clientWidth
  const heuristicFooterCompact = shouldUseCompactComposerFooter(composerFormWidth, {
    hasWideActions: composerFooterHasWideActions,
  })
  const footer = composerFooterRef.current
  const footerStyle = footer ? window.getComputedStyle(footer) : null
  const footerContentWidth = resolveComposerFooterContentWidth({
    footerWidth: footer?.clientWidth ?? null,
    paddingLeft: footerStyle ? Number.parseFloat(footerStyle.paddingLeft) : null,
    paddingRight: footerStyle ? Number.parseFloat(footerStyle.paddingRight) : null,
  })
  const fitInput = {
    footerContentWidth,
    leadingContentWidth: composerFooterLeadingRef.current?.scrollWidth ?? null,
    actionsWidth: composerFooterActionsRef.current?.scrollWidth ?? null,
  }
  const footerCompact = heuristicFooterCompact || shouldForceCompactComposerFooterForFit(fitInput)
  const primaryActionsCompact =
    footerCompact &&
    shouldUseCompactComposerPrimaryActions(composerFormWidth, {
      hasWideActions: composerFooterHasWideActions,
    })
  return { footerCompact, primaryActionsCompact }
}

export function useComposerLayoutObserver(
  refs: ScrollRefs,
  scheduleStickToBottom: () => void,
  input: ChatScrollInput,
  setIsComposerFooterCompact: React.Dispatch<React.SetStateAction<boolean>>,
  setIsComposerPrimaryActionsCompact: React.Dispatch<React.SetStateAction<boolean>>
) {
  const {
    composerFormRef,
    composerFormHeightRef,
    composerFooterRef,
    composerFooterLeadingRef,
    composerFooterActionsRef,
    shouldAutoScrollRef,
  } = refs

  useLayoutEffect(() => {
    const composerForm = composerFormRef.current
    if (!composerForm) return
    const measureCompactness = () =>
      measureFooterCompactness(
        composerForm,
        composerFooterRef,
        composerFooterLeadingRef,
        composerFooterActionsRef,
        input.composerFooterHasWideActions
      )

    composerFormHeightRef.current = composerForm.getBoundingClientRect().height
    const initial = measureCompactness()
    setIsComposerPrimaryActionsCompact(initial.primaryActionsCompact)
    setIsComposerFooterCompact(initial.footerCompact)
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(entries => {
      const [entry] = entries
      if (!entry) return
      const next = measureCompactness()
      setIsComposerPrimaryActionsCompact(prev =>
        prev === next.primaryActionsCompact ? prev : next.primaryActionsCompact
      )
      setIsComposerFooterCompact(prev => (prev === next.footerCompact ? prev : next.footerCompact))
      const nextHeight = entry.contentRect.height
      const prevHeight = composerFormHeightRef.current
      composerFormHeightRef.current = nextHeight
      if (prevHeight > 0 && Math.abs(nextHeight - prevHeight) < 0.5) return
      if (!shouldAutoScrollRef.current) return
      scheduleStickToBottom()
    })
    observer.observe(composerForm)
    return () => {
      observer.disconnect()
    }
  }, [
    input.activeThreadId,
    input.composerFooterActionLayoutKey,
    input.composerFooterHasWideActions,
    scheduleStickToBottom,
    composerFormRef,
    composerFormHeightRef,
    composerFooterRef,
    composerFooterLeadingRef,
    composerFooterActionsRef,
    shouldAutoScrollRef,
    setIsComposerFooterCompact,
    setIsComposerPrimaryActionsCompact,
  ])
}
