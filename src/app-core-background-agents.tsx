import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { SessionMessageBundle } from '@shared/ipc'
import { UnifiedTimelineRowView } from './components/chat/UnifiedTimelineRow'
import type { UnifiedBackgroundAgentSummary } from './lib/session-presentation'
import { selectSessionPresentation } from './state/unified-runtime-store'

type UseAppCoreBackgroundAgentsArgs = {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  visibleBackgroundAgents: UnifiedBackgroundAgentSummary[]
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    bundles: SessionMessageBundle[]
  ) => void
  openReferencedFile: (reference: string) => Promise<void>
  refreshProject: (directory: string, silent?: boolean) => Promise<unknown>
  setArchivedBackgroundAgentIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setStatusLine: (message: string) => void
}

export function useAppCoreBackgroundAgents({
  activeProjectDir,
  activeSessionID,
  visibleBackgroundAgents,
  setOpencodeMessages,
  openReferencedFile,
  refreshProject,
  setArchivedBackgroundAgentIds,
  setStatusLine,
}: UseAppCoreBackgroundAgentsArgs) {
  const [selectedBackgroundAgentId, setSelectedBackgroundAgentId] = useState<string | null>(null)
  const [selectedBackgroundAgentLoading, setSelectedBackgroundAgentLoading] = useState(false)
  const [selectedBackgroundAgentError, setSelectedBackgroundAgentError] = useState<string | null>(null)

  const selectedBackgroundAgent = useMemo(
    () => visibleBackgroundAgents.find(agent => agent.id === selectedBackgroundAgentId) ?? null,
    [selectedBackgroundAgentId, visibleBackgroundAgents]
  )
  const selectedBackgroundAgentSessionID =
    selectedBackgroundAgent?.provider === 'opencode'
      ? (selectedBackgroundAgent.sessionID ?? null)
      : null
  const selectedBackgroundAgentPrompt =
    selectedBackgroundAgent?.provider === 'opencode'
      ? (selectedBackgroundAgent.prompt ?? null)
      : null

  useEffect(() => {
    setSelectedBackgroundAgentId(null)
    setSelectedBackgroundAgentLoading(false)
    setSelectedBackgroundAgentError(null)
  }, [activeSessionID])

  useEffect(() => {
    if (selectedBackgroundAgentId && !selectedBackgroundAgent) {
      setSelectedBackgroundAgentId(null)
    }
  }, [selectedBackgroundAgent, selectedBackgroundAgentId])

  useSelectedBackgroundAgentPolling({
    activeProjectDir,
    selectedBackgroundAgentSessionID,
    setOpencodeMessages,
    setSelectedBackgroundAgentError,
    setSelectedBackgroundAgentLoading,
  })

  const backgroundAgentDetail = useMemo(
    () =>
      buildBackgroundAgentDetail({
        activeProjectDir,
        openReferencedFile,
        selectedBackgroundAgent,
        selectedBackgroundAgentPrompt,
        selectedBackgroundAgentSessionID,
      }),
    [
      activeProjectDir,
      openReferencedFile,
      selectedBackgroundAgent,
      selectedBackgroundAgentPrompt,
      selectedBackgroundAgentSessionID,
    ]
  )

  const backgroundAgentTaskText = useMemo(
    () =>
      buildBackgroundAgentTaskText({
        activeProjectDir,
        selectedBackgroundAgent,
        selectedBackgroundAgentPrompt,
        selectedBackgroundAgentSessionID,
      }),
    [
      activeProjectDir,
      selectedBackgroundAgent,
      selectedBackgroundAgentPrompt,
      selectedBackgroundAgentSessionID,
    ]
  )

  const handleArchiveBackgroundAgent = useArchiveBackgroundAgent({
    activeProjectDir,
    refreshProject,
    selectedBackgroundAgentId,
    setArchivedBackgroundAgentIds,
    setSelectedBackgroundAgentId,
    setStatusLine,
  })

  return {
    backgroundAgentDetail,
    backgroundAgentTaskText,
    handleArchiveBackgroundAgent,
    selectedBackgroundAgentError,
    selectedBackgroundAgentId,
    selectedBackgroundAgentLoading,
    setSelectedBackgroundAgentId,
  }
}

function useSelectedBackgroundAgentPolling({
  activeProjectDir,
  selectedBackgroundAgentSessionID,
  setOpencodeMessages,
  setSelectedBackgroundAgentError,
  setSelectedBackgroundAgentLoading,
}: {
  activeProjectDir: string | undefined
  selectedBackgroundAgentSessionID: string | null
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    bundles: SessionMessageBundle[]
  ) => void
  setSelectedBackgroundAgentError: Dispatch<SetStateAction<string | null>>
  setSelectedBackgroundAgentLoading: Dispatch<SetStateAction<boolean>>
}) {
  useEffect(() => {
    if (!selectedBackgroundAgentSessionID || !activeProjectDir) {
      setSelectedBackgroundAgentLoading(false)
      setSelectedBackgroundAgentError(null)
      return
    }
    const bridge = window.orxa?.opencode
    if (!bridge?.loadMessages) {
      setSelectedBackgroundAgentLoading(false)
      setSelectedBackgroundAgentError(null)
      return
    }
    let cancelled = false
    let timer: number | null = null

    const load = async (showLoading = false) => {
      if (cancelled) {
        return
      }
      if (showLoading) {
        setSelectedBackgroundAgentLoading(true)
      }
      try {
        const bundles = await bridge.loadMessages(activeProjectDir, selectedBackgroundAgentSessionID)
        if (cancelled) {
          return
        }
        setOpencodeMessages(activeProjectDir, selectedBackgroundAgentSessionID, bundles)
        setSelectedBackgroundAgentError(null)
      } catch (error) {
        if (!cancelled) {
          setSelectedBackgroundAgentError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled && showLoading) {
          setSelectedBackgroundAgentLoading(false)
        }
      }
    }

    void load(true)
    timer = window.setInterval(() => void load(false), 1300)

    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearInterval(timer)
      }
    }
  }, [
    activeProjectDir,
    selectedBackgroundAgentSessionID,
    setOpencodeMessages,
    setSelectedBackgroundAgentError,
    setSelectedBackgroundAgentLoading,
  ])
}

function useArchiveBackgroundAgent({
  activeProjectDir,
  refreshProject,
  selectedBackgroundAgentId,
  setArchivedBackgroundAgentIds,
  setSelectedBackgroundAgentId,
  setStatusLine,
}: {
  activeProjectDir: string | undefined
  refreshProject: (directory: string, silent?: boolean) => Promise<unknown>
  selectedBackgroundAgentId: string | null
  setArchivedBackgroundAgentIds: Dispatch<SetStateAction<Record<string, string[]>>>
  setSelectedBackgroundAgentId: Dispatch<SetStateAction<string | null>>
  setStatusLine: (message: string) => void
}) {
  return useCallback(
    async (agent: UnifiedBackgroundAgentSummary) => {
      if (!activeProjectDir || !agent.sessionID) {
        return
      }
      try {
        await window.orxa.opencode.abortSession(activeProjectDir, agent.sessionID).catch(() => false)
        await window.orxa.opencode.archiveSession(activeProjectDir, agent.sessionID)
        setArchivedBackgroundAgentIds(current => {
          const next = { ...current }
          const existing = new Set(next[activeProjectDir] ?? [])
          existing.add(agent.id)
          existing.add(agent.sessionID!)
          next[activeProjectDir] = [...existing]
          return next
        })
        if (selectedBackgroundAgentId === agent.id) {
          setSelectedBackgroundAgentId(null)
        }
        await refreshProject(activeProjectDir)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      activeProjectDir,
      refreshProject,
      selectedBackgroundAgentId,
      setArchivedBackgroundAgentIds,
      setSelectedBackgroundAgentId,
      setStatusLine,
    ]
  )
}

function buildBackgroundAgentDetail({
  activeProjectDir,
  openReferencedFile,
  selectedBackgroundAgent,
  selectedBackgroundAgentPrompt,
  selectedBackgroundAgentSessionID,
}: {
  activeProjectDir: string | undefined
  openReferencedFile: (reference: string) => Promise<void>
  selectedBackgroundAgent: UnifiedBackgroundAgentSummary | null
  selectedBackgroundAgentPrompt: string | null
  selectedBackgroundAgentSessionID: string | null
}) {
  if (!selectedBackgroundAgent || selectedBackgroundAgent.provider !== 'opencode') {
    return null
  }
  const projected = buildProjectedBackgroundSession({
    activeProjectDir,
    selectedBackgroundAgent,
    selectedBackgroundAgentSessionID,
  })
  if (!projected || projected.rows.length === 0) {
    return null
  }
  const normalizedPrompt = selectedBackgroundAgentPrompt
    ? normalizeTranscriptText(selectedBackgroundAgentPrompt)
    : null
  let taskRowConsumed = false
  const filteredRows = projected.rows.filter(row => {
    if (row.kind !== 'message' || row.role !== 'user') {
      return true
    }
    const rowText = normalizeTranscriptText(
      row.sections
        .filter(
          (section): section is Extract<(typeof row.sections)[number], { type: 'text' }> =>
            section.type === 'text'
        )
        .map(section => section.content)
        .join('\n')
    )
    if (normalizedPrompt && rowText === normalizedPrompt) {
      return false
    }
    if (!taskRowConsumed) {
      taskRowConsumed = true
      return false
    }
    return true
  })
  if (filteredRows.length === 0) {
    return null
  }
  return (
    <div className="agent-dock-detail-transcript">
      {filteredRows.map(row => (
        <UnifiedTimelineRowView
          key={row.id}
          row={row}
          onOpenFileReference={reference => void openReferencedFile(reference)}
        />
      ))}
    </div>
  )
}

function buildBackgroundAgentTaskText({
  activeProjectDir,
  selectedBackgroundAgent,
  selectedBackgroundAgentPrompt,
  selectedBackgroundAgentSessionID,
}: {
  activeProjectDir: string | undefined
  selectedBackgroundAgent: UnifiedBackgroundAgentSummary | null
  selectedBackgroundAgentPrompt: string | null
  selectedBackgroundAgentSessionID: string | null
}) {
  if (!selectedBackgroundAgent || selectedBackgroundAgent.provider !== 'opencode') {
    return null
  }
  const projected = buildProjectedBackgroundSession({
    activeProjectDir,
    selectedBackgroundAgent,
    selectedBackgroundAgentSessionID,
  })
  if (!projected) {
    return null
  }
  const normalizedPrompt = selectedBackgroundAgentPrompt
    ? normalizeTranscriptText(selectedBackgroundAgentPrompt)
    : null
  const firstUserRow = projected.rows.find(row => row.kind === 'message' && row.role === 'user')
  if (!firstUserRow || firstUserRow.kind !== 'message') {
    return null
  }
  const taskText = firstUserRow.sections
    .filter(
      (section): section is Extract<(typeof firstUserRow.sections)[number], { type: 'text' }> =>
        section.type === 'text'
    )
    .map(section => section.content)
    .join('\n')
    .trim()
  if (!taskText) {
    return null
  }
  return normalizedPrompt && normalizeTranscriptText(taskText) === normalizedPrompt
    ? null
    : taskText
}

function buildProjectedBackgroundSession({
  activeProjectDir,
  selectedBackgroundAgent,
  selectedBackgroundAgentSessionID,
}: {
  activeProjectDir: string | undefined
  selectedBackgroundAgent: UnifiedBackgroundAgentSummary
  selectedBackgroundAgentSessionID: string | null
}) {
  return activeProjectDir && selectedBackgroundAgentSessionID
    ? selectSessionPresentation({
        provider: 'opencode',
        directory: activeProjectDir,
        sessionID: selectedBackgroundAgentSessionID,
        assistantLabel: selectedBackgroundAgent.name,
      })
    : null
}

function normalizeTranscriptText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}
