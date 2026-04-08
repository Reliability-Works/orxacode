import { useCallback, useMemo } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ThreadId, type TurnId } from '@orxa-code/contracts'
import { gitBranchesQueryOptions } from '~/lib/gitReactQuery'
import { checkpointDiffQueryOptions } from '~/lib/providerReactQuery'
import { parseDiffRouteSearch, stripDiffSearchParams } from '../diffRouteSearch'
import { useTurnDiffSummaries } from '../hooks/useTurnDiffSummaries'
import { useStore } from '../store'
import { useSettings } from '../hooks/useSettings'

export interface OrderedTurnDiffSummary {
  turnId: TurnId
  completedAt: string
  checkpointTurnCount?: number | undefined
}

function resolveCheckpointRange(
  selectedTurnId: TurnId | null,
  selectedCheckpointTurnCount: number | undefined,
  conversationCheckpointTurnCount: number | undefined
): { fromTurnCount: number; toTurnCount: number } | null {
  if (selectedTurnId !== null && typeof selectedCheckpointTurnCount === 'number') {
    return {
      fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
      toTurnCount: selectedCheckpointTurnCount,
    }
  }
  if (selectedTurnId === null && typeof conversationCheckpointTurnCount === 'number') {
    return { fromTurnCount: 0, toTurnCount: conversationCheckpointTurnCount }
  }
  return null
}

function useTurnNavigation(activeThread: { id: string } | undefined) {
  const navigate = useNavigate()
  const selectTurn = useCallback(
    (turnId: TurnId) => {
      if (!activeThread) return
      void navigate({
        to: '/$threadId',
        params: { threadId: activeThread.id },
        search: prev => ({ ...stripDiffSearchParams(prev), diff: '1', diffTurnId: turnId }),
      })
    },
    [activeThread, navigate]
  )

  const selectWholeConversation = useCallback(() => {
    if (!activeThread) return
    void navigate({
      to: '/$threadId',
      params: { threadId: activeThread.id },
      search: prev => ({ ...stripDiffSearchParams(prev), diff: '1' }),
    })
  }, [activeThread, navigate])

  return { selectTurn, selectWholeConversation }
}

function useConversationTurnCount(
  orderedTurnDiffSummaries: OrderedTurnDiffSummary[],
  inferredCheckpointTurnCountByTurnId: Record<string, number>
): number | undefined {
  return useMemo(() => {
    const counts = orderedTurnDiffSummaries
      .map(s => s.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[s.turnId])
      .filter((v): v is number => typeof v === 'number')
    if (counts.length === 0) return undefined
    const latest = Math.max(...counts)
    return latest > 0 ? latest : undefined
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries])
}

function useActiveCheckpointDiff(
  activeThreadId: ThreadId | null,
  activeCheckpointRange: { fromTurnCount: number; toTurnCount: number } | null,
  selectedTurnId: TurnId | null,
  selectedTurn: OrderedTurnDiffSummary | undefined,
  orderedTurnDiffSummaries: OrderedTurnDiffSummary[],
  isGitRepo: boolean
) {
  const conversationCacheScope = useMemo(() => {
    if (selectedTurnId !== null || orderedTurnDiffSummaries.length === 0) return null
    return `conversation:${orderedTurnDiffSummaries.map(s => s.turnId).join(',')}`
  }, [orderedTurnDiffSummaries, selectedTurnId])

  return useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo,
    })
  )
}

type DiffSearch = ReturnType<typeof parseDiffRouteSearch>

function useSelectedCheckpointDiff(input: {
  diffSearch: DiffSearch
  orderedTurnDiffSummaries: OrderedTurnDiffSummary[]
  inferredCheckpointTurnCountByTurnId: Record<string, number>
  activeThreadId: ThreadId | null
  isGitRepo: boolean
}) {
  const {
    diffSearch,
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    activeThreadId,
    isGitRepo,
  } = input
  const selectedTurnId = diffSearch.diffTurnId ?? null
  const selectedFilePath = selectedTurnId !== null ? (diffSearch.diffFilePath ?? null) : null
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find(s => s.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0])
  const selectedCheckpointTurnCount =
    selectedTurn?.checkpointTurnCount ??
    (selectedTurn ? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId] : undefined)
  const conversationCheckpointTurnCount = useConversationTurnCount(
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId
  )
  const activeCheckpointRange = resolveCheckpointRange(
    selectedTurnId,
    selectedCheckpointTurnCount,
    conversationCheckpointTurnCount
  )
  const activeCheckpointDiffQuery = useActiveCheckpointDiff(
    activeThreadId,
    activeCheckpointRange,
    selectedTurnId,
    selectedTurn,
    orderedTurnDiffSummaries,
    isGitRepo
  )
  const activePatch = activeCheckpointDiffQuery.data?.diff
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? 'Failed to load checkpoint diff.'
        : null
  return {
    selectedTurnId,
    selectedFilePath,
    selectedTurn,
    activePatch,
    isLoadingCheckpointDiff,
    checkpointDiffError,
  }
}

function useDiffPanelRouteContext() {
  const settings = useSettings()
  const routeThreadId = useParams({
    strict: false,
    select: params => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  })
  const diffSearch = useSearch({ strict: false, select: search => parseDiffRouteSearch(search) })
  const diffOpen = diffSearch.diff === '1'
  const activeThreadId = routeThreadId
  const activeThread = useStore(store =>
    activeThreadId ? store.threads.find(t => t.id === activeThreadId) : undefined
  )
  const activeProjectId = activeThread?.projectId ?? null
  const activeProject = useStore(store =>
    activeProjectId ? store.projects.find(p => p.id === activeProjectId) : undefined
  )
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd
  const gitBranchesQuery = useQuery(gitBranchesQueryOptions(activeCwd ?? null))
  const isGitRepo = gitBranchesQuery.data?.isRepo ?? true
  return {
    settings,
    diffSearch,
    diffOpen,
    activeThreadId,
    activeThread,
    activeCwd,
    isGitRepo,
  }
}

export function useDiffPanelState() {
  const { settings, diffSearch, diffOpen, activeThreadId, activeThread, activeCwd, isGitRepo } =
    useDiffPanelRouteContext()
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread)

  const orderedTurnDiffSummaries: OrderedTurnDiffSummary[] = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0
        const rightCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0
        return leftCount !== rightCount
          ? rightCount - leftCount
          : right.completedAt.localeCompare(left.completedAt)
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries]
  )

  const {
    selectedTurnId,
    selectedFilePath,
    selectedTurn,
    activePatch,
    isLoadingCheckpointDiff,
    checkpointDiffError,
  } = useSelectedCheckpointDiff({
    diffSearch,
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    activeThreadId,
    isGitRepo,
  })

  const { selectTurn, selectWholeConversation } = useTurnNavigation(activeThread)

  return {
    settings,
    diffOpen,
    activeThreadId,
    activeThread,
    activeCwd,
    isGitRepo,
    orderedTurnDiffSummaries,
    inferredCheckpointTurnCountByTurnId,
    selectedTurnId,
    selectedFilePath,
    selectedTurn,
    activePatch,
    isLoadingCheckpointDiff,
    checkpointDiffError,
    selectTurn,
    selectWholeConversation,
  }
}
