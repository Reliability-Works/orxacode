/**
 * ChatView behavior hooks - Part 3:
 * Prompt change, drag/paste, command key, revert user message.
 */

import { useCallback } from 'react'
import type { ProviderKind, ThreadId } from '@orxa-code/contracts'
import { detectComposerTrigger, getSlashCommandsForProvider } from '../../composer-logic'
import type { TerminalContextDraft } from '../../lib/terminalContext'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'

type L = ReturnType<typeof useChatViewLocalState>
type S = ReturnType<typeof useChatViewStoreSelectors>
type A = ReturnType<typeof useChatViewDerivedActivities>

function syncTerminalContextsByIds(
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>
): TerminalContextDraft[] {
  const byId = new Map(contexts.map(c => [c.id, c]))
  return ids.flatMap(id => {
    const c = byId.get(id)
    return c ? [c] : []
  })
}

function terminalContextIdListsEqual(
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>
): boolean {
  return contexts.length === ids.length && contexts.every((c, i) => c.id === ids[i])
}

// ---------------------------------------------------------------------------
// onPromptChange
// ---------------------------------------------------------------------------

export function usePromptChangeCallback(
  threadId: ThreadId,
  ls: L,
  store: S,
  ad: A,
  setPrompt: (s: string) => void,
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean
  ) => void,
  selectedProvider: ProviderKind
) {
  const { promptRef, setComposerCursor, setComposerTrigger } = ls
  const { setComposerDraftTerminalContexts } = store
  const { activePendingProgress, activePendingUserInput } = ad
  const allowedCommands = getSlashCommandsForProvider(selectedProvider)

  return useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[]
    ) => {
      if (activePendingProgress?.activeQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention
        )
        return
      }
      promptRef.current = nextPrompt
      setPrompt(nextPrompt)
      const composerTerminalContexts = store.composerTerminalContexts
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          threadId,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds)
        )
      }
      setComposerCursor(nextCursor)
      setComposerTrigger(
        cursorAdjacentToMention
          ? null
          : detectComposerTrigger(nextPrompt, expandedCursor, allowedCommands)
      )
    },
    [
      activePendingProgress,
      activePendingUserInput,
      allowedCommands,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setComposerCursor,
      setComposerDraftTerminalContexts,
      setComposerTrigger,
      setPrompt,
      store,
      threadId,
    ]
  )
}

// ---------------------------------------------------------------------------
// Drag / paste handlers
// ---------------------------------------------------------------------------

export function useComposerDragHandlers(
  ls: L,
  addComposerImages: (files: File[]) => void,
  focusComposer: () => void
) {
  const { dragDepthRef, setIsDragOverComposer } = ls

  const onComposerDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      dragDepthRef.current += 1
      setIsDragOverComposer(true)
    },
    [dragDepthRef, setIsDragOverComposer]
  )

  const onComposerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsDragOverComposer(true)
    },
    [setIsDragOverComposer]
  )

  const onComposerDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setIsDragOverComposer(false)
    },
    [dragDepthRef, setIsDragOverComposer]
  )

  const onComposerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      dragDepthRef.current = 0
      setIsDragOverComposer(false)
      addComposerImages(Array.from(event.dataTransfer.files))
      focusComposer()
    },
    [addComposerImages, dragDepthRef, focusComposer, setIsDragOverComposer]
  )

  const onComposerPaste = useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData.files).filter(f => f.type.startsWith('image/'))
      if (files.length === 0) return
      event.preventDefault()
      addComposerImages(files)
    },
    [addComposerImages]
  )

  return {
    onComposerDragEnter,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onComposerPaste,
  }
}

// ---------------------------------------------------------------------------
// onComposerCommandKey
// ---------------------------------------------------------------------------

export function buildComposerCommandKey(params: {
  composerMenuOpenRef: L['composerMenuOpenRef']
  composerMenuItemsRef: L['composerMenuItemsRef']
  activeComposerMenuItemRef: L['activeComposerMenuItemRef']
  nudgeComposerMenuHighlight: (key: 'ArrowDown' | 'ArrowUp') => void
  onSelectComposerItem: (item: { id: string; type: string; [k: string]: unknown }) => void
  resolveActiveComposerTrigger: () => { trigger: { rangeStart: number; rangeEnd: number } | null }
  toggleInteractionMode: () => void
  onSend: (e?: { preventDefault: () => void }) => void | Promise<void>
}) {
  return (key: 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab', event: KeyboardEvent): boolean => {
    const { composerMenuOpenRef, composerMenuItemsRef, activeComposerMenuItemRef } = params
    const {
      nudgeComposerMenuHighlight,
      onSelectComposerItem,
      resolveActiveComposerTrigger,
      toggleInteractionMode,
      onSend,
    } = params
    if (key === 'Tab' && event.shiftKey) {
      toggleInteractionMode()
      return true
    }
    const { trigger } = resolveActiveComposerTrigger()
    const menuIsActive = composerMenuOpenRef.current || trigger !== null
    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current
      if ((key === 'ArrowDown' || key === 'ArrowUp') && currentItems.length > 0) {
        nudgeComposerMenuHighlight(key)
        return true
      }
      if (key === 'Tab' || key === 'Enter') {
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0]
        if (selectedItem) {
          onSelectComposerItem(selectedItem)
          return true
        }
      }
    }
    if (key === 'Enter' && !event.shiftKey) {
      void onSend()
      return true
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// onRevertUserMessage
// ---------------------------------------------------------------------------

export function buildOnRevertUserMessage(
  revertTurnCountByUserMessageId: Map<string, number>,
  onRevertToTurnCount: (count: number) => Promise<void>
) {
  return (messageId: string): void => {
    const targetTurnCount = revertTurnCountByUserMessageId.get(messageId)
    if (typeof targetTurnCount !== 'number') return
    void onRevertToTurnCount(targetTurnCount)
  }
}

// ---------------------------------------------------------------------------
// removeComposerImage delegate
// ---------------------------------------------------------------------------

export function buildRemoveComposerImage(removeComposerImageFromDraft: (imageId: string) => void) {
  return (imageId: string): void => removeComposerImageFromDraft(imageId)
}
