import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CodexThread } from '@shared/ipc'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { SubagentInfo } from '../hooks/useCodexSession'
import type { TodoItem } from './chat/TodoDock'
import type { ReviewChangeItem } from './chat/ReviewChangesDock'
import { UnifiedTimelineRowView } from './chat/UnifiedTimelineRow'
import {
  buildCodexBackgroundAgents,
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  extractCodexTodoItemsFromMessages,
  filterOutCurrentCodexThreadAgent,
  projectCodexSessionPresentation,
} from '../lib/session-presentation'
import { buildCodexMessagesFromThread, extractThreadFromResumeResponse } from '../lib/codex-thread-transcript'
import { extractReviewChangesFiles } from '../lib/timeline-row-grouping'
import { getCodexUsageAlert } from './CodexPane.helpers'

function buildBackgroundAgents({
  childThreads,
  messages,
  subagents,
}: {
  childThreads?: CodexThread[]
  messages: CodexMessageItem[]
  subagents: SubagentInfo[]
}) {
  if (subagents.length > 0) return buildCodexBackgroundAgents(subagents)
  if (childThreads?.length) return buildCodexBackgroundAgentsFromChildThreads(childThreads)
  return buildCodexBackgroundAgentsFromMessages(messages)
}

function buildSubagentRows(
  rows: ReturnType<typeof projectCodexSessionPresentation>['rows']
) {
  const firstUserRowIndex = rows.findIndex(row => row.kind === 'message' && row.role === 'user')
  return firstUserRowIndex >= 0 ? rows.slice(firstUserRowIndex + 1) : rows
}

function renderSubagentDetailBody({
  activeSubagentThreadId,
  onOpenFileReference,
  subagentRows,
}: {
  activeSubagentThreadId: string | null
  onOpenFileReference?: (reference: string) => void
  subagentRows: ReturnType<typeof projectCodexSessionPresentation>['rows']
}) {
  if (!activeSubagentThreadId) return undefined
  return (
    <div className="agent-dock-detail-transcript">
      {subagentRows.length > 0 ? (
        subagentRows.map(row => (
          <UnifiedTimelineRowView key={row.id} row={row} onOpenFileReference={onOpenFileReference} />
        ))
      ) : (
        <p className="agent-dock-detail-state">This background agent has not produced any visible output yet.</p>
      )}
    </div>
  ) satisfies ReactNode
}

function useCodexSubagentPresentation({
  activeSubagentMessages,
  activeSubagentThreadId,
  onOpenFileReference,
}: {
  activeSubagentMessages: CodexMessageItem[]
  activeSubagentThreadId: string | null
  onOpenFileReference?: (reference: string) => void
}) {
  const subagentPresentationRows = useMemo(
    () => projectCodexSessionPresentation(activeSubagentMessages, false).rows,
    [activeSubagentMessages]
  )
  const subagentTaskText = useMemo(() => {
    const firstUserRow = subagentPresentationRows.find(row => row.kind === 'message' && row.role === 'user')
    if (!firstUserRow || firstUserRow.kind !== 'message') return null
    const text = firstUserRow.sections.filter(section => section.type === 'text').map(section => section.content).join('\n').trim()
    return text || null
  }, [subagentPresentationRows])
  const subagentRows = useMemo(() => buildSubagentRows(subagentPresentationRows), [subagentPresentationRows])
  const subagentDetailBody = renderSubagentDetailBody({
    activeSubagentThreadId,
    onOpenFileReference,
    subagentRows,
  })
  return { subagentDetailBody, subagentTaskText }
}

function useCodexSubagentTranscript({
  activeSubagentThreadId,
  subagentMessages,
}: {
  activeSubagentThreadId: string | null
  subagentMessages: CodexMessageItem[]
}) {
  const [subagentThreadMessages, setSubagentThreadMessages] = useState<Record<string, CodexMessageItem[]>>({})
  const [subagentThreadLoading, setSubagentThreadLoading] = useState<Record<string, boolean>>({})
  const [subagentThreadErrors, setSubagentThreadErrors] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!activeSubagentThreadId || subagentThreadMessages[activeSubagentThreadId] || !window.orxa?.codex?.resumeThread) {
      return
    }
    let cancelled = false
    setSubagentThreadLoading(current => ({ ...current, [activeSubagentThreadId]: true }))
    setSubagentThreadErrors(current => ({ ...current, [activeSubagentThreadId]: null }))
    void window.orxa.codex.resumeThread(activeSubagentThreadId).then(response => {
      if (cancelled) return
      const threadRecord = extractThreadFromResumeResponse(response)
      if (!threadRecord) {
        setSubagentThreadErrors(current => ({ ...current, [activeSubagentThreadId]: 'Unable to load agent thread.' }))
        return
      }
      setSubagentThreadMessages(current => ({ ...current, [activeSubagentThreadId]: buildCodexMessagesFromThread(threadRecord) }))
    }).catch(error => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : String(error)
      setSubagentThreadErrors(current => ({ ...current, [activeSubagentThreadId]: message || 'Unable to load agent thread.' }))
    }).finally(() => {
      if (!cancelled) setSubagentThreadLoading(current => ({ ...current, [activeSubagentThreadId]: false }))
    })
    return () => {
      cancelled = true
    }
  }, [activeSubagentThreadId, subagentThreadMessages])

  const activeSubagentMessages = useMemo(
    () => (activeSubagentThreadId ? subagentThreadMessages[activeSubagentThreadId] ?? subagentMessages : []),
    [activeSubagentThreadId, subagentMessages, subagentThreadMessages]
  )

  return { activeSubagentMessages, subagentThreadErrors, subagentThreadLoading }
}

export function useCodexPaneSubagentState({
  activeSubagentThreadId,
  closeSubagentThread,
  childThreads,
  lastError,
  messages,
  onOpenFileReference,
  openSubagentThread,
  planItems,
  subagentMessages,
  subagents,
  threadId,
}: {
  activeSubagentThreadId: string | null
  childThreads?: CodexThread[]
  closeSubagentThread: () => void
  lastError?: string | null
  messages: CodexMessageItem[]
  onOpenFileReference?: (reference: string) => void
  openSubagentThread: (threadId: string) => void
  planItems: TodoItem[]
  subagentMessages: CodexMessageItem[]
  subagents: SubagentInfo[]
  threadId?: string
}) {
  const [todoOpen, setTodoOpen] = useState(false)
  const [archivedBackgroundAgentIds, setArchivedBackgroundAgentIds] = useState<string[]>([])
  const { activeSubagentMessages, subagentThreadErrors, subagentThreadLoading } =
    useCodexSubagentTranscript({
      activeSubagentThreadId,
      subagentMessages,
    })

  const rawBackgroundAgents = useMemo(
    () => buildBackgroundAgents({ childThreads, messages, subagents }),
    [childThreads, messages, subagents]
  )
  const effectiveBackgroundAgents = useMemo(
    () =>
      filterOutCurrentCodexThreadAgent(
        rawBackgroundAgents.filter(agent => !archivedBackgroundAgentIds.includes(agent.id)),
        threadId
      ),
    [archivedBackgroundAgentIds, rawBackgroundAgents, threadId]
  )
  const effectiveTodoItems = useMemo(
    () => (planItems.length > 0 ? planItems : extractCodexTodoItemsFromMessages(messages)),
    [messages, planItems]
  )
  const reviewChangesFiles: ReviewChangeItem[] = useMemo(
    () => extractReviewChangesFiles(projectCodexSessionPresentation(messages, false).rows),
    [messages]
  )
  const showReviewChangesDrawer =
    effectiveTodoItems.length > 0 &&
    effectiveTodoItems.every(item => item.status === 'completed') &&
    reviewChangesFiles.length > 0
  const codexUsageAlert = useMemo(() => getCodexUsageAlert(lastError ?? undefined), [lastError])
  const { subagentDetailBody, subagentTaskText } = useCodexSubagentPresentation({
    activeSubagentMessages,
    activeSubagentThreadId,
    onOpenFileReference,
  })

  useEffect(() => {
    setArchivedBackgroundAgentIds(current =>
      current.filter(id => rawBackgroundAgents.some(agent => agent.id === id))
    )
  }, [rawBackgroundAgents])

  const handleArchiveBackgroundAgent = useCallback(
    async (agent: (typeof effectiveBackgroundAgents)[number]) => {
      if (!window.orxa?.codex || !agent.sessionID) return
      await window.orxa.codex.archiveThreadTree(agent.id)
      setArchivedBackgroundAgentIds(current => (current.includes(agent.id) ? current : [...current, agent.id]))
      if (activeSubagentThreadId === agent.id) closeSubagentThread()
    },
    [activeSubagentThreadId, closeSubagentThread]
  )

  return {
    codexUsageAlert,
    effectiveBackgroundAgents,
    effectiveTodoItems,
    handleArchiveBackgroundAgent,
    handleOpenBackgroundAgent: openSubagentThread,
    handleOpenReviewChange: onOpenFileReference ?? (() => undefined),
    reviewChangesFiles,
    selectedBackgroundAgentDetailError: activeSubagentThreadId ? (subagentThreadErrors[activeSubagentThreadId] ?? null) : null,
    selectedBackgroundAgentDetailLoading: activeSubagentThreadId ? (subagentThreadLoading[activeSubagentThreadId] ?? false) : false,
    showReviewChangesDrawer,
    subagentDetailBody,
    subagentTaskText,
    todoOpen,
    toggleTodoOpen: () => setTodoOpen(value => !value),
  }
}
