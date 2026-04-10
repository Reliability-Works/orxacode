import type { ThreadId } from '@orxa-code/contracts'

import { useUiStateStore } from '../../uiStateStore'

export function useChatViewUiThreadSelectors(threadId: ThreadId) {
  const markThreadVisited = useUiStateStore(store => store.markThreadVisited)
  const threadEnvModeOverride = useUiStateStore(store => store.threadEnvModeById[threadId] ?? null)
  const setThreadEnvMode = useUiStateStore(store => store.setThreadEnvMode)
  const activeThreadLastVisitedAt = useUiStateStore(
    store => store.threadLastVisitedAtById[threadId]
  )

  return {
    markThreadVisited,
    threadEnvModeOverride,
    setThreadEnvMode,
    activeThreadLastVisitedAt,
  }
}
