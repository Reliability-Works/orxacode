import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComposerPanelProps } from './ComposerPanel'
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'
import type { UnifiedBackgroundAgentSummary } from '../lib/session-presentation'
import { buildClaudeChatBackgroundAgents } from '../lib/session-presentation'
import { projectClaudeChatProjectedSessionPresentation } from '../lib/claude-chat-session-presentation'

type ClaudeChatSubagentHistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

type UseClaudeChatPaneSubagentsArgs = {
  subagents: ClaudeChatSubagentState[]
  loadSubagentMessages: (sessionID: string) => Promise<ClaudeChatSubagentHistoryMessage[]>
  archiveProviderSession: (sessionID: string) => Promise<unknown>
}

export type ClaudeChatPaneSubagentsViewModel = {
  backgroundAgents: UnifiedBackgroundAgentSummary[]
  selectedBackgroundAgentId: string | null
  onOpenBackgroundAgent: NonNullable<ComposerPanelProps['onOpenBackgroundAgent']>
  onCloseBackgroundAgent: NonNullable<ComposerPanelProps['onCloseBackgroundAgent']>
  onArchiveBackgroundAgent: NonNullable<ComposerPanelProps['onArchiveBackgroundAgent']>
  backgroundAgentDetailRows: ReturnType<
    typeof projectClaudeChatProjectedSessionPresentation
  >['rows'] | null
  backgroundAgentTaskText: string | null
  backgroundAgentDetailLoading: boolean
  backgroundAgentDetailError: string | null
}

function historyToMessageItems(messages: ClaudeChatSubagentHistoryMessage[]): ClaudeChatMessageItem[] {
  return messages.map(message => ({
    id: message.id,
    kind: 'message' as const,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }))
}

function useClaudeChatSubagentHistory(
  activeSubagent: ClaudeChatSubagentState | null,
  loadSubagentMessages: (sessionID: string) => Promise<ClaudeChatSubagentHistoryMessage[]>
) {
  const [subagentMessages, setSubagentMessages] = useState<Record<string, ClaudeChatMessageItem[]>>(
    {}
  )
  const [subagentLoading, setSubagentLoading] = useState<Record<string, boolean>>({})
  const [subagentErrors, setSubagentErrors] = useState<Record<string, string | null>>({})
  const loadedSubagentIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const sessionID = activeSubagent?.sessionID
    if (!sessionID) {
      return
    }
    let cancelled = false
    let timer: number | null = null
    const shouldShowLoading = !loadedSubagentIdsRef.current.has(activeSubagent.id)

    const load = async (showLoading: boolean) => {
      if (showLoading) {
        setSubagentLoading(prev => ({ ...prev, [activeSubagent.id]: true }))
      }
      setSubagentErrors(prev => ({ ...prev, [activeSubagent.id]: null }))
      try {
        const history = await loadSubagentMessages(sessionID)
        if (!cancelled) {
          loadedSubagentIdsRef.current.add(activeSubagent.id)
          setSubagentMessages(prev => ({
            ...prev,
            [activeSubagent.id]: historyToMessageItems(history),
          }))
        }
      } catch (error) {
        if (!cancelled) {
          setSubagentErrors(prev => ({
            ...prev,
            [activeSubagent.id]: error instanceof Error ? error.message : String(error),
          }))
        }
      } finally {
        if (!cancelled && showLoading) {
          setSubagentLoading(prev => ({ ...prev, [activeSubagent.id]: false }))
        }
      }
    }

    void load(shouldShowLoading)
    timer = window.setInterval(() => {
      void load(false)
    }, 1300)

    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearInterval(timer)
      }
    }
  }, [activeSubagent, loadSubagentMessages])

  return { subagentMessages, subagentLoading, subagentErrors }
}

export function useClaudeChatPaneSubagents({
  subagents,
  loadSubagentMessages,
  archiveProviderSession,
}: UseClaudeChatPaneSubagentsArgs): ClaudeChatPaneSubagentsViewModel {
  const [selectedBackgroundAgentId, setSelectedBackgroundAgentId] = useState<string | null>(null)
  const [archivedBackgroundAgentIds, setArchivedBackgroundAgentIds] = useState<string[]>([])

  const activeSubagent = useMemo(
    () => subagents.find(agent => agent.id === selectedBackgroundAgentId) ?? null,
    [selectedBackgroundAgentId, subagents]
  )
  const rawBackgroundAgents = useMemo(() => buildClaudeChatBackgroundAgents(subagents), [subagents])
  const backgroundAgents = useMemo(
    () =>
      rawBackgroundAgents.filter(
        agent =>
          !archivedBackgroundAgentIds.includes(agent.id) &&
          !(agent.sessionID && archivedBackgroundAgentIds.includes(agent.sessionID))
      ),
    [archivedBackgroundAgentIds, rawBackgroundAgents]
  )
  const { subagentMessages, subagentLoading, subagentErrors } = useClaudeChatSubagentHistory(
    activeSubagent,
    loadSubagentMessages
  )

  useEffect(() => {
    setArchivedBackgroundAgentIds(current =>
      current.filter(id => rawBackgroundAgents.some(agent => agent.id === id || agent.sessionID === id))
    )
  }, [rawBackgroundAgents])

  const backgroundAgentDetailRows = useMemo(() => {
    if (!activeSubagent) {
      return null
    }
    const detailMessages = subagentMessages[activeSubagent.id] ?? []
    return projectClaudeChatProjectedSessionPresentation(detailMessages, false).rows
  }, [activeSubagent, subagentMessages])

  const onArchiveBackgroundAgent = async (agent: UnifiedBackgroundAgentSummary) => {
    const sessionID = agent.sessionID
    if (sessionID) {
      await archiveProviderSession(sessionID)
    }
    setArchivedBackgroundAgentIds(current => {
      const next = new Set(current)
      next.add(agent.id)
      if (sessionID) {
        next.add(sessionID)
      }
      return [...next]
    })
    if (selectedBackgroundAgentId === agent.id) {
      setSelectedBackgroundAgentId(null)
    }
  }

  return {
    backgroundAgents,
    selectedBackgroundAgentId,
    onOpenBackgroundAgent: id => setSelectedBackgroundAgentId(id),
    onCloseBackgroundAgent: () => setSelectedBackgroundAgentId(null),
    onArchiveBackgroundAgent,
    backgroundAgentDetailRows,
    backgroundAgentTaskText: activeSubagent?.taskText ?? null,
    backgroundAgentDetailLoading: activeSubagent ? (subagentLoading[activeSubagent.id] ?? false) : false,
    backgroundAgentDetailError: activeSubagent ? (subagentErrors[activeSubagent.id] ?? null) : null,
  }
}
