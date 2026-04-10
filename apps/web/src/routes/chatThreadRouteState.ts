import { ThreadId } from '@orxa-code/contracts'
import { useMemo } from 'react'

import { useComposerDraftStore } from '../composerDraftStore'
import { useStore } from '../store'

export function deriveChatThreadRouteState(input: {
  threadExists: boolean
  draftThreadExists: boolean
}) {
  return {
    routeThreadExists: input.threadExists || input.draftThreadExists,
  }
}

export function useChatThreadRouteState(threadId: ThreadId) {
  const threadExists = useStore(store => store.threads.some(thread => thread.id === threadId))
  const draftThreadExists = useComposerDraftStore(store =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId)
  )

  return useMemo(
    () =>
      deriveChatThreadRouteState({
        threadExists,
        draftThreadExists,
      }),
    [draftThreadExists, threadExists]
  )
}
