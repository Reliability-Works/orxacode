/**
 * ChatView behavior hooks - Part 1:
 * Core utility, composer draft, PR dialog, scroll, attachment preview.
 */

import { useCallback } from 'react'
import { DEFAULT_RUNTIME_MODE, DEFAULT_INTERACTION_MODE } from '../../types'
import { type ThreadId } from '@orxa-code/contracts'
import { useStore } from '../../store'
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
} from '../../composer-logic'
import {
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
  type TerminalContextSelection,
  type TerminalContextDraft,
} from '../../lib/terminalContext'
import { revokeBlobPreviewUrl } from '../ChatView.logic'
import { randomUUID, newThreadId } from '~/lib/utils'
import { setupProjectScript } from '../../projectScripts'
import type { ComposerImageAttachment, DraftThreadEnvMode } from '../../composerDraftStore'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type T = ReturnType<typeof useChatViewDerivedThread>
type A = ReturnType<typeof useChatViewDerivedActivities>

export function useCoreUtilCallbacks(threadId: ThreadId, store: S, ls: L) {
  const { setStoreThreadError, setComposerDraftPrompt } = store
  const { setLocalDraftErrorsByThreadId, composerEditorRef } = ls

  const setThreadError = useCallback(
    (id: ThreadId | null, error: string | null) => {
      if (!id) return
      if (useStore.getState().threads.some(t => t.id === id)) {
        setStoreThreadError(id, error)
        return
      }
      setLocalDraftErrorsByThreadId(ex =>
        (ex[id] ?? null) === error ? ex : { ...ex, [id]: error }
      )
    },
    [setStoreThreadError, setLocalDraftErrorsByThreadId]
  )

  const focusComposer = useCallback(() => {
    composerEditorRef.current?.focusAtEnd()
  }, [composerEditorRef])
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerEditorRef.current?.focusAtEnd()
    })
  }, [composerEditorRef])
  const setPrompt = useCallback(
    (next: string) => {
      setComposerDraftPrompt(threadId, next)
    },
    [setComposerDraftPrompt, threadId]
  )

  return { setThreadError, focusComposer, scheduleComposerFocus, setPrompt }
}

function useRemoveTerminalContextCallback(
  threadId: ThreadId,
  store: S,
  ls: L,
  setPrompt: (s: string) => void
) {
  const { removeComposerDraftTerminalContext } = store
  const { promptRef, composerTerminalContextsRef, setComposerCursor, setComposerTrigger } = ls
  return useCallback(
    (contextId: string) => {
      const idx = composerTerminalContextsRef.current.findIndex(c => c.id === contextId)
      if (idx < 0) return
      const next = removeInlineTerminalContextPlaceholder(promptRef.current, idx)
      promptRef.current = next.prompt
      setPrompt(next.prompt)
      removeComposerDraftTerminalContext(threadId, contextId)
      setComposerCursor(next.cursor)
      setComposerTrigger(
        detectComposerTrigger(next.prompt, expandCollapsedComposerCursor(next.prompt, next.cursor))
      )
    },
    [
      composerTerminalContextsRef,
      promptRef,
      removeComposerDraftTerminalContext,
      setComposerCursor,
      setComposerTrigger,
      setPrompt,
      threadId,
    ]
  )
}

function useAddTerminalContextCallback(store: S, ls: L, td: T) {
  const { insertComposerDraftTerminalContext } = store
  const { composerEditorRef, promptRef, setComposerCursor, setComposerTrigger } = ls
  const { activeThread } = td
  return useCallback(
    (sel: TerminalContextSelection) => {
      if (!activeThread) return
      const cur =
        composerEditorRef.current?.readSnapshot()?.expandedCursor ??
        expandCollapsedComposerCursor(promptRef.current, promptRef.current.length)
      const ins = insertInlineTerminalContextPlaceholder(promptRef.current, cur)
      const nextCursor = collapseExpandedComposerCursor(ins.prompt, ins.cursor)
      if (
        !insertComposerDraftTerminalContext(
          activeThread.id,
          ins.prompt,
          {
            id: randomUUID(),
            threadId: activeThread.id,
            createdAt: new Date().toISOString(),
            ...sel,
          },
          ins.contextIndex
        )
      )
        return
      promptRef.current = ins.prompt
      setComposerCursor(nextCursor)
      setComposerTrigger(detectComposerTrigger(ins.prompt, ins.cursor))
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor)
      })
    },
    [
      activeThread,
      composerEditorRef,
      insertComposerDraftTerminalContext,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
    ]
  )
}

export function useComposerDraftCallbacks(
  threadId: ThreadId,
  store: S,
  ls: L,
  td: T,
  ad: A,
  setPrompt: (s: string) => void
) {
  const {
    addComposerDraftImage,
    addComposerDraftImages,
    removeComposerDraftImage,
    addComposerDraftTerminalContexts,
  } = store
  void ad
  const addComposerImage = useCallback(
    (img: ComposerImageAttachment) => {
      addComposerDraftImage(threadId, img)
    },
    [addComposerDraftImage, threadId]
  )
  const addComposerImagesToDraft = useCallback(
    (imgs: ComposerImageAttachment[]) => {
      addComposerDraftImages(threadId, imgs)
    },
    [addComposerDraftImages, threadId]
  )
  const addComposerTerminalContextsToDraft = useCallback(
    (ctxs: TerminalContextDraft[]) => {
      addComposerDraftTerminalContexts(threadId, ctxs)
    },
    [addComposerDraftTerminalContexts, threadId]
  )
  const removeComposerImage = useCallback(
    (id: string) => {
      removeComposerDraftImage(threadId, id)
    },
    [removeComposerDraftImage, threadId]
  )
  const removeComposerTerminalContextFromDraft = useRemoveTerminalContextCallback(
    threadId,
    store,
    ls,
    setPrompt
  )
  const addTerminalContextToDraft = useAddTerminalContextCallback(store, ls, td)

  return {
    addComposerImage,
    addComposerImagesToDraft,
    addComposerTerminalContextsToDraft,
    removeComposerImage,
    removeComposerTerminalContextFromDraft,
    addTerminalContextToDraft,
  }
}

function useOpenOrReuseProjectDraftThreadCallback(threadId: ThreadId, store: S, td: T) {
  const {
    navigate,
    getDraftThreadByProjectId,
    getDraftThread,
    setDraftThreadContext,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
  } = store
  const { isServerThread, activeProject } = td
  return useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) throw new Error('No active project is available for this pull request.')
      const stored = getDraftThreadByProjectId(activeProject.id)
      if (stored) {
        setDraftThreadContext(stored.threadId, input)
        setProjectDraftThreadId(activeProject.id, stored.threadId, input)
        if (stored.threadId !== threadId)
          await navigate({ to: '/$threadId', params: { threadId: stored.threadId } })
        return stored.threadId
      }
      const active = getDraftThread(threadId)
      if (!isServerThread && active?.projectId === activeProject.id) {
        setDraftThreadContext(threadId, input)
        setProjectDraftThreadId(activeProject.id, threadId, input)
        return threadId
      }
      clearProjectDraftThreadId(activeProject.id)
      const next = newThreadId()
      setProjectDraftThreadId(activeProject.id, next, {
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      })
      await navigate({ to: '/$threadId', params: { threadId: next } })
      return next
    },
    [
      activeProject,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      isServerThread,
      navigate,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ]
  )
}

export function usePullRequestCallbacks(threadId: ThreadId, store: S, ls: L, td: T) {
  const {
    setComposerHighlightedItemId,
    setPullRequestDialogState,
    setPendingPullRequestSetupRequest,
  } = ls
  const { canCheckoutPullRequestIntoThread, activeProject } = td

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) return
      setPullRequestDialogState({ initialReference: reference ?? null, key: Date.now() })
      setComposerHighlightedItemId(null)
    },
    [canCheckoutPullRequestIntoThread, setComposerHighlightedItemId, setPullRequestDialogState]
  )

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null)
  }, [setPullRequestDialogState])

  const openOrReuseProjectDraftThread = useOpenOrReuseProjectDraftThreadCallback(
    threadId,
    store,
    td
  )

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      const targetId = await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? 'worktree' : 'local',
      })
      const setupScript =
        input.worktreePath && activeProject ? setupProjectScript(activeProject.scripts) : null
      if (targetId && input.worktreePath && setupScript)
        setPendingPullRequestSetupRequest({
          threadId: targetId,
          worktreePath: input.worktreePath,
          scriptId: setupScript.id,
        })
      else setPendingPullRequestSetupRequest(null)
    },
    [activeProject, openOrReuseProjectDraftThread, setPendingPullRequestSetupRequest]
  )

  return {
    openPullRequestDialog,
    closePullRequestDialog,
    openOrReuseProjectDraftThread,
    handlePreparedPullRequestThread,
  }
}

export function useScrollCallbacks(
  messagesScrollRef: React.MutableRefObject<HTMLDivElement | null>
) {
  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = messagesScrollRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
    },
    [messagesScrollRef]
  )

  return { scrollMessagesToBottom }
}

export function useAttachmentPreviewCallbacks(ls: L) {
  const {
    attachmentPreviewHandoffByMessageIdRef,
    attachmentPreviewHandoffTimeoutByMessageIdRef,
    setAttachmentPreviewHandoffByMessageId,
  } = ls

  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const t of Object.values(attachmentPreviewHandoffTimeoutByMessageIdRef.current))
      window.clearTimeout(t)
    attachmentPreviewHandoffTimeoutByMessageIdRef.current = {}
    for (const urls of Object.values(attachmentPreviewHandoffByMessageIdRef.current))
      for (const u of urls) revokeBlobPreviewUrl(u)
    attachmentPreviewHandoffByMessageIdRef.current = {}
    setAttachmentPreviewHandoffByMessageId({})
  }, [
    attachmentPreviewHandoffByMessageIdRef,
    attachmentPreviewHandoffTimeoutByMessageIdRef,
    setAttachmentPreviewHandoffByMessageId,
  ])

  const handoffAttachmentPreviews = useCallback(
    (messageId: string, previewUrls: string[]) => {
      if (previewUrls.length === 0) return
      const prev = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? []
      for (const u of prev) if (!previewUrls.includes(u)) revokeBlobPreviewUrl(u)
      setAttachmentPreviewHandoffByMessageId(ex => {
        const next = { ...ex, [messageId]: previewUrls }
        attachmentPreviewHandoffByMessageIdRef.current = next
        return next
      })
      const existing = attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId]
      if (typeof existing === 'number') window.clearTimeout(existing)
      attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
        const cur = attachmentPreviewHandoffByMessageIdRef.current[messageId]
        if (cur) for (const u of cur) revokeBlobPreviewUrl(u)
        setAttachmentPreviewHandoffByMessageId(ex => {
          if (!(messageId in ex)) return ex
          const next = { ...ex }
          delete next[messageId]
          attachmentPreviewHandoffByMessageIdRef.current = next
          return next
        })
        delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId]
      }, 5000)
    },
    [
      attachmentPreviewHandoffByMessageIdRef,
      attachmentPreviewHandoffTimeoutByMessageIdRef,
      setAttachmentPreviewHandoffByMessageId,
    ]
  )

  return { clearAttachmentPreviewHandoffs, handoffAttachmentPreviews }
}
