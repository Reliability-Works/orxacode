import { useParams, useSearch } from '@tanstack/react-router'
import { ThreadId } from '@orxa-code/contracts'
import { useCallback } from 'react'
import type { MouseEvent } from 'react'

import { isMacPlatform } from '../../lib/utils'

interface SidebarThreadNavigationParams {
  navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  setSelectionAnchor: (threadId: ThreadId) => void
  toggleThreadSelection: (threadId: ThreadId) => void
  rangeSelectTo: (threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => void
}

function useNavigateInFocusedPane(
  navigate: SidebarThreadNavigationParams['navigate'],
  setSelectionAnchor: (threadId: ThreadId) => void,
  clearSelection: () => void,
  selectedThreadCount: number
) {
  const routeThreadId = useParams({
    strict: false,
    select: currentParams =>
      currentParams.threadId ? ThreadId.makeUnsafe(currentParams.threadId) : null,
  })
  const routeSearch = useSearch({ strict: false })

  return useCallback(
    (threadId: ThreadId) => {
      if (selectedThreadCount > 0) clearSelection()
      setSelectionAnchor(threadId)
      if (
        routeSearch.split === '1' &&
        routeSearch.focusedPane === 'secondary' &&
        routeThreadId !== null &&
        threadId !== routeThreadId
      ) {
        void navigate({
          to: '/$threadId',
          params: { threadId: routeThreadId },
          search: previous => ({
            ...previous,
            split: '1',
            secondaryThreadId: threadId,
            focusedPane: 'secondary',
          }),
        })
        return
      }
      void navigate({ to: '/$threadId', params: { threadId } })
    },
    [
      clearSelection,
      navigate,
      routeSearch.focusedPane,
      routeSearch.split,
      routeThreadId,
      selectedThreadCount,
      setSelectionAnchor,
    ]
  )
}

export function useSidebarThreadNavigation(params: SidebarThreadNavigationParams) {
  const navigateInFocusedPane = useNavigateInFocusedPane(
    params.navigate,
    params.setSelectionAnchor,
    params.clearSelection,
    params.selectedThreadIds.size
  )

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform)
      const isModClick = isMac ? event.metaKey : event.ctrlKey
      if (isModClick) {
        event.preventDefault()
        params.toggleThreadSelection(threadId)
        return
      }
      if (event.shiftKey) {
        event.preventDefault()
        params.rangeSelectTo(threadId, orderedProjectThreadIds)
        return
      }
      navigateInFocusedPane(threadId)
    },
    [navigateInFocusedPane, params]
  )

  return {
    navigateToThread: navigateInFocusedPane,
    handleThreadClick,
  }
}
