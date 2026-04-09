import { ThreadId } from '@orxa-code/contracts'
import { createFileRoute, retainSearchParams, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { type DiffRouteSearch, parseDiffRouteSearch, stripDiffSearchParams } from '../diffRouteSearch'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useStore } from '../store'
import { type ChatSplitPane } from '../components/chat/ChatSplitPaneContext'
import { ChatThreadInlineLayout, ChatThreadSheetLayout } from './chatThreadLayout'
import { useChatThreadRouteState } from './chatThreadRouteState'

const DIFF_INLINE_LAYOUT_MEDIA_QUERY = '(max-width: 1180px)'

function useSplitSearchState(search: DiffRouteSearch, threadId: ThreadId, defaultSecondaryThreadId: ThreadId | null) {
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
  diffOpen: boolean
  splitOpen: boolean
  secondaryThreadId: ThreadId | null
}) {
  const { diffOpen, navigate, secondaryThreadId, splitOpen, threadId } = params
  const closeDiff = useCallback(() => {
    void navigate({ to: '/$threadId', params: { threadId }, search: { diff: undefined } })
  }, [navigate, threadId])

  const openDiff = useCallback(() => {
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => ({ ...stripDiffSearchParams(previous), diff: '1' }),
    })
  }, [navigate, threadId])

  const closeSplit = useCallback(() => {
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => ((rest => (diffOpen ? { ...rest, diff: '1' } : rest))(stripDiffSearchParams(previous))),
    })
  }, [diffOpen, navigate, threadId])

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

  return { closeDiff, openDiff, toggleSplit, focusPane, toggleMaximize }
}

function ChatThreadRouteView() {
  const bootstrapComplete = useStore(store => store.bootstrapComplete)
  const navigate = useNavigate()
  const threadId = Route.useParams({ select: params => ThreadId.makeUnsafe(params.threadId) })
  const search = Route.useSearch()
  const { routeThreadExists, defaultSecondaryThreadId } = useChatThreadRouteState(threadId)
  const splitState = useSplitSearchState(search, threadId, defaultSecondaryThreadId)
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY)
  const [hasOpenedDiff, setHasOpenedDiff] = useState(search.diff === '1')
  const actions = useThreadRouteActions({
    navigate,
    threadId,
    diffOpen: search.diff === '1',
    splitOpen: splitState.splitOpen,
    secondaryThreadId: splitState.secondaryThreadId,
  })

  useEffect(() => {
    if (search.diff === '1') {
      setHasOpenedDiff(true)
    }
  }, [search.diff])

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
    diffOpen: search.diff === '1',
    onCloseDiff: actions.closeDiff,
    onToggleSplit: actions.toggleSplit,
    onFocusPane: actions.focusPane,
    onToggleMaximize: actions.toggleMaximize,
    renderDiffContent: search.diff === '1' || hasOpenedDiff,
  }

  if (shouldUseDiffSheet) {
    return <ChatThreadSheetLayout {...layoutProps} />
  }

  return <ChatThreadInlineLayout {...layoutProps} onOpenDiff={actions.openDiff} />
}

export const Route = createFileRoute('/_chat/$threadId')({
  validateSearch: search => parseDiffRouteSearch(search),
  search: {
    middlewares: [
      retainSearchParams<DiffRouteSearch>([
        'diff',
        'split',
        'secondaryThreadId',
        'focusedPane',
        'maximizedPane',
      ]),
    ],
  },
  component: ChatThreadRouteView,
})
