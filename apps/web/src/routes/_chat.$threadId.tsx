import { ThreadId } from '@orxa-code/contracts'
import { createFileRoute, retainSearchParams, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'

import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from '../diffRouteSearch'
import { useStore } from '../store'
import { type ChatSplitPane } from '../components/chat/ChatSplitPaneContext'
import { ChatThreadInlineLayout } from './chatThreadLayout'
import { useChatThreadRouteState } from './chatThreadRouteState'

function useSplitSearchState(
  search: DiffRouteSearch,
  threadId: ThreadId,
  defaultSecondaryThreadId: ThreadId | null
) {
  const secondaryThreadId =
    search.secondaryThreadId && search.secondaryThreadId !== threadId
      ? search.secondaryThreadId
      : defaultSecondaryThreadId
  return {
    secondaryThreadId,
    splitOpen: search.split === '1' && secondaryThreadId !== null,
    focusedPane: search.focusedPane === 'secondary' ? 'secondary' : 'primary',
    maximizedPane:
      search.maximizedPane === 'primary' || search.maximizedPane === 'secondary'
        ? search.maximizedPane
        : null,
  } satisfies {
    secondaryThreadId: ThreadId | null
    splitOpen: boolean
    focusedPane: ChatSplitPane
    maximizedPane: ChatSplitPane | null
  }
}

function useThreadRouteActions(params: {
  navigate: ReturnType<typeof useNavigate>
  threadId: ThreadId
  splitOpen: boolean
  secondaryThreadId: ThreadId | null
}) {
  const { navigate, secondaryThreadId, splitOpen, threadId } = params

  const closeSplit = useCallback(() => {
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => stripDiffSearchParams(previous),
    })
  }, [navigate, threadId])

  const openSplit = useCallback(() => {
    if (!secondaryThreadId) return
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => ({
        ...previous,
        split: '1',
        secondaryThreadId,
        focusedPane: 'secondary',
        maximizedPane: undefined,
      }),
    })
  }, [navigate, secondaryThreadId, threadId])
  const toggleSplit = useCallback(() => {
    if (splitOpen) {
      closeSplit()
      return
    }
    openSplit()
  }, [closeSplit, openSplit, splitOpen])

  const focusPane = useCallback(
    (pane: ChatSplitPane) => {
      if (!splitOpen) return
      void navigate({
        to: '/$threadId',
        params: { threadId },
        search: previous => ({ ...previous, focusedPane: pane }),
      })
    },
    [navigate, splitOpen, threadId]
  )

  const toggleMaximize = useCallback(
    (pane: ChatSplitPane) => {
      if (!splitOpen) return
      void navigate({
        to: '/$threadId',
        params: { threadId },
        search: previous => ({
          ...previous,
          maximizedPane: previous.maximizedPane === pane ? undefined : pane,
        }),
      })
    },
    [navigate, splitOpen, threadId]
  )

  return { toggleSplit, focusPane, toggleMaximize }
}

function ChatThreadRouteView() {
  const bootstrapComplete = useStore(store => store.bootstrapComplete)
  const navigate = useNavigate()
  const threadId = Route.useParams({ select: params => ThreadId.makeUnsafe(params.threadId) })
  const search = Route.useSearch()
  const { routeThreadExists, defaultSecondaryThreadId } = useChatThreadRouteState(threadId)
  const splitState = useSplitSearchState(search, threadId, defaultSecondaryThreadId)
  const actions = useThreadRouteActions({
    navigate,
    threadId,
    splitOpen: splitState.splitOpen,
    secondaryThreadId: splitState.secondaryThreadId,
  })

  useEffect(() => {
    if (!bootstrapComplete || routeThreadExists) {
      return
    }
    void navigate({ to: '/', replace: true })
  }, [bootstrapComplete, navigate, routeThreadExists])

  if (!bootstrapComplete || !routeThreadExists) {
    return null
  }

  const layoutProps = {
    threadId,
    secondaryThreadId: splitState.secondaryThreadId,
    splitOpen: splitState.splitOpen,
    focusedPane: splitState.focusedPane,
    maximizedPane: splitState.maximizedPane,
    onToggleSplit: actions.toggleSplit,
    onFocusPane: actions.focusPane,
    onToggleMaximize: actions.toggleMaximize,
  }
  return <ChatThreadInlineLayout {...layoutProps} />
}

export const Route = createFileRoute('/_chat/$threadId')({
  validateSearch: search => parseDiffRouteSearch(search),
  search: {
    middlewares: [
      retainSearchParams<DiffRouteSearch>([
        'split',
        'secondaryThreadId',
        'focusedPane',
        'maximizedPane',
      ]),
    ],
  },
  component: ChatThreadRouteView,
})
