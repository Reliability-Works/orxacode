import { ThreadId } from '@orxa-code/contracts'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useComposerDraftStore } from '../composerDraftStore'
import { useStore } from '../store'
import { useUiStateStore } from '../uiStateStore'
import { buildDefaultSecondaryThreadId } from './chatThreadLayout.helpers'

export function deriveChatThreadRouteState(input: {
  threadId: ThreadId
  threadIds: ReadonlyArray<ThreadId>
  threadLastVisitedAtById: Record<string, string>
  threadExists: boolean
  draftThreadExists: boolean
}) {
  return {
    routeThreadExists: input.threadExists || input.draftThreadExists,
    defaultSecondaryThreadId: buildDefaultSecondaryThreadId(
      input.threadId,
      input.threadLastVisitedAtById,
      input.threadIds
    ),
  }
}

export function useChatThreadRouteState(threadId: ThreadId) {
  const threadExists = useStore(store => store.threads.some(thread => thread.id === threadId))
  const threadIds = useStore(useShallow(store => store.threads.map(thread => thread.id)))
  const threadLastVisitedAtById = useUiStateStore(store => store.threadLastVisitedAtById)
  const draftThreadExists = useComposerDraftStore(store =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId)
  )

  return useMemo(
    () =>
      deriveChatThreadRouteState({
        threadId,
        threadIds,
        threadLastVisitedAtById,
        threadExists,
        draftThreadExists,
      }),
    [draftThreadExists, threadExists, threadId, threadIds, threadLastVisitedAtById]
  )
}
