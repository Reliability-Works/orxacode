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
import { ChatThreadInlineLayout } from './-chatThreadLayout'
import { useChatThreadRouteState } from './-chatThreadRouteState'
import { useComposerDraftStore } from '../composerDraftStore'
import { useUiStateStore } from '../uiStateStore'

function useSplitSearchState(search: DiffRouteSearch, threadId: ThreadId) {
  const secondaryThreadId =
    search.secondaryThreadId && search.secondaryThreadId !== threadId
      ? search.secondaryThreadId
      : null
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
  projectId: import('@orxa-code/contracts').ProjectId | null
  requestSplitNewSession: (projectId: import('@orxa-code/contracts').ProjectId) => void
}) {
  const { navigate, splitOpen, threadId, projectId, requestSplitNewSession } = params

  const closeSplit = useCallback(() => {
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => stripDiffSearchParams(previous),
    })
  }, [navigate, threadId])

  const openSplit = useCallback(() => {
    if (!projectId) return
    requestSplitNewSession(projectId)
  }, [projectId, requestSplitNewSession])

  const openSecondaryWithThread = useCallback(
    (secondaryThreadId: ThreadId) => {
      if (secondaryThreadId === threadId) return
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
    },
    [navigate, threadId]
  )
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

  return { toggleSplit, focusPane, toggleMaximize, openSecondaryWithThread }
}

function ChatThreadRouteView() {
  const bootstrapComplete = useStore(store => store.bootstrapComplete)
  const navigate = useNavigate()
  const threadId = Route.useParams({ select: params => ThreadId.makeUnsafe(params.threadId) })
  const routeThread = useStore(store => store.threads.find(thread => thread.id === threadId))
  const draftThread = useComposerDraftStore(store => store.draftThreadsByThreadId[threadId] ?? null)
  const search = Route.useSearch()
  const requestNewSessionModal = useUiStateStore(store => store.requestNewSessionModal)
  const { routeThreadExists } = useChatThreadRouteState(threadId)
  const splitState = useSplitSearchState(search, threadId)
  const secondaryThread = useStore(store =>
    splitState.secondaryThreadId
      ? (store.threads.find(thread => thread.id === splitState.secondaryThreadId) ?? null)
      : null
  )
  const activeProjectId = routeThread?.projectId ?? draftThread?.projectId ?? null
  const actions = useThreadRouteActions({
    navigate,
    threadId,
    splitOpen: splitState.splitOpen,
    projectId: activeProjectId,
    requestSplitNewSession: projectId =>
      requestNewSessionModal({
        projectId,
        mode: 'split-secondary',
        primaryThreadId: threadId,
      }),
  })

  useEffect(() => {
    if (!bootstrapComplete || routeThreadExists) {
      return
    }
    void navigate({ to: '/', replace: true })
  }, [bootstrapComplete, navigate, routeThreadExists])

  // Auto-close the split pane when the secondary session is archived or removed
  // (deletion strips it from the store). Leaving it in place would show a stale
  // thread the user can no longer interact with.
  useEffect(() => {
    if (!bootstrapComplete) return
    if (!splitState.splitOpen || !splitState.secondaryThreadId) return
    const secondaryGone = secondaryThread === null
    const secondaryArchived = secondaryThread?.archivedAt != null
    if (!secondaryGone && !secondaryArchived) return
    void navigate({
      to: '/$threadId',
      params: { threadId },
      search: previous => stripDiffSearchParams(previous),
    })
  }, [
    bootstrapComplete,
    navigate,
    secondaryThread,
    splitState.secondaryThreadId,
    splitState.splitOpen,
    threadId,
  ])

  if (!bootstrapComplete || !routeThreadExists) {
    return null
  }

  const layoutProps = {
    threadId,
    projectId: activeProjectId,
    secondaryThreadId: splitState.secondaryThreadId,
    splitOpen: splitState.splitOpen,
    focusedPane: splitState.focusedPane,
    maximizedPane: splitState.maximizedPane,
    onToggleSplit: actions.toggleSplit,
    onFocusPane: actions.focusPane,
    onToggleMaximize: actions.toggleMaximize,
    onOpenSecondary: actions.openSecondaryWithThread,
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
