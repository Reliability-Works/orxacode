import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, Bot, ChevronDown, ExternalLink } from 'lucide-react'
import { DockSurface } from './DockSurface'
import type { UnifiedBackgroundAgentSummary } from '../../lib/session-presentation'
import { agentColorForId } from '../../hooks/useCodexSession'

interface BackgroundAgentsPanelProps {
  agents: UnifiedBackgroundAgentSummary[]
  selectedAgentId?: string | null
  onOpenAgent: (id: string) => void
  onBack: () => void
  onArchiveAgent?: (agent: UnifiedBackgroundAgentSummary) => void
  detailBody?: ReactNode
  detailTaskText?: string | null
  detailLoading?: boolean
  detailError?: string | null
  taggingHint?: string | null
}

export const BackgroundAgentsPanel = memo(function BackgroundAgentsPanel({
  agents,
  selectedAgentId,
  onOpenAgent,
  onBack,
  onArchiveAgent,
  detailBody,
  detailTaskText = null,
  detailLoading = false,
  detailError = null,
  taggingHint = '(@ to tag agents)',
}: BackgroundAgentsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [taskExpanded, setTaskExpanded] = useState(false)
  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  )
  const activeAgentCount = useMemo(
    () =>
      agents.filter(agent => agent.status === 'thinking' || agent.status === 'awaiting_instruction')
        .length,
    [agents]
  )
  const title = useMemo(() => {
    const base = `${agents.length} background agent${agents.length === 1 ? '' : 's'}`
    return activeAgentCount > 0 ? `${base} (${activeAgentCount} active)` : base
  }, [activeAgentCount, agents.length])

  useEffect(() => {
    setPromptExpanded(false)
    setTaskExpanded(false)
  }, [selectedAgentId])

  if (agents.length === 0) {
    return null
  }

  return (
    <>
      <DockSurface
        title={title}
        icon={<Bot size={13} />}
        headerAction={
          <button
            type="button"
            className="agent-dock-header-toggle"
            aria-label={expanded ? 'Collapse background agents' : 'Expand background agents'}
            aria-expanded={expanded}
            title={taggingHint ?? undefined}
            onClick={() => setExpanded(value => !value)}
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`agent-dock-toggle-chevron ${expanded ? 'is-open' : ''}`.trim()}
            />
          </button>
        }
        className={`dock-surface--compact-width${expanded ? '' : ' dock-surface--collapsed-inline'}`.trim()}
        bodyClassName="agent-dock-surface-body"
      >
        <div className="agent-dock">{expanded ? <AgentList agents={agents} onOpenAgent={onOpenAgent} onArchiveAgent={onArchiveAgent} /> : null}</div>
      </DockSurface>

      {selectedAgent ? (
        <AgentDetailModal
          agent={selectedAgent}
          onArchiveAgent={onArchiveAgent}
          onBack={onBack}
          promptExpanded={promptExpanded}
          setPromptExpanded={setPromptExpanded}
          taskExpanded={taskExpanded}
          setTaskExpanded={setTaskExpanded}
          detailBody={detailBody}
          detailLoading={detailLoading}
          detailError={detailError}
          detailTaskText={detailTaskText}
        />
      ) : null}
    </>
  )
})

function AgentList({
  agents,
  onOpenAgent,
  onArchiveAgent,
}: {
  agents: UnifiedBackgroundAgentSummary[]
  onOpenAgent: (id: string) => void
  onArchiveAgent?: (agent: UnifiedBackgroundAgentSummary) => void
}) {
  return (
    <div className="agent-dock-list" role="list">
      {agents.map(agent => (
        <div key={agent.id} className="agent-dock-row" role="listitem">
          <div className="agent-dock-row-main">
            <span className="agent-dock-row-name" style={{ color: agentColorForId(agent.id) }}>
              {agent.name}
            </span>
            {agent.role ? <span className="agent-dock-row-role">({agent.role})</span> : null}
            <span className={`agent-dock-status agent-dock-status--${agent.status}`.trim()}>
              {agent.statusText}
            </span>
          </div>
          <div className="agent-dock-row-actions">
            <button
              type="button"
              className="agent-dock-action"
              aria-label={`Open ${agent.name}`}
              title={`Open ${agent.name}`}
              onClick={() => onOpenAgent(agent.id)}
            >
              <ExternalLink size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="agent-dock-action"
              onClick={() => onArchiveAgent?.(agent)}
              disabled={!onArchiveAgent || !agent.sessionID}
              aria-disabled={!onArchiveAgent || !agent.sessionID}
              aria-label={`Archive ${agent.name}`}
              title={`Archive ${agent.name}`}
            >
              <Archive size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentCollapsible({
  title,
  expanded,
  setExpanded,
  children,
}: {
  title: string
  expanded: boolean
  setExpanded: (updater: (current: boolean) => boolean) => void
  children: ReactNode
}) {
  return (
    <section className="agent-dock-collapsible">
      <button
        type="button"
        className="agent-dock-collapsible-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="agent-dock-collapsible-title">{title}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`agent-dock-collapsible-chevron ${expanded ? 'is-open' : ''}`.trim()}
        />
      </button>
      {expanded ? <div className="agent-dock-collapsible-body">{children}</div> : null}
    </section>
  )
}

function AgentDetailModal({
  agent,
  onArchiveAgent,
  onBack,
  promptExpanded,
  setPromptExpanded,
  taskExpanded,
  setTaskExpanded,
  detailBody,
  detailLoading,
  detailError,
  detailTaskText,
}: {
  agent: UnifiedBackgroundAgentSummary
  onArchiveAgent?: (agent: UnifiedBackgroundAgentSummary) => void
  onBack: () => void
  promptExpanded: boolean
  setPromptExpanded: (updater: (current: boolean) => boolean) => void
  taskExpanded: boolean
  setTaskExpanded: (updater: (current: boolean) => boolean) => void
  detailBody?: ReactNode
  detailTaskText?: string | null
  detailLoading?: boolean
  detailError?: string | null
}) {
  return (
    <div className="overlay" onClick={onBack}>
      <section
        className="modal agent-dock-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="background-agent-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="background-agent-modal-title">Background agent</h2>
          <div className="agent-dock-modal-actions">
            <button
              type="button"
              className="agent-dock-action"
              onClick={() => onArchiveAgent?.(agent)}
              disabled={!onArchiveAgent || !agent.sessionID}
              aria-disabled={!onArchiveAgent || !agent.sessionID}
              aria-label="Archive background agent"
              title={`Archive ${agent.name}`}
            >
              <Archive size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Close background agent"
              onClick={onBack}
            >
              ×
            </button>
          </div>
        </header>

        <div className="agent-dock-detail agent-dock-modal-body">
          <AgentDetailSummary agent={agent} />

          {agent.prompt ? (
            <AgentCollapsible title="Prompt" expanded={promptExpanded} setExpanded={setPromptExpanded}>
              <pre className="agent-dock-collapsible-text">{agent.prompt}</pre>
            </AgentCollapsible>
          ) : null}

          {detailTaskText ? (
            <AgentCollapsible title="Task" expanded={taskExpanded} setExpanded={setTaskExpanded}>
              <pre className="agent-dock-collapsible-text">{detailTaskText}</pre>
            </AgentCollapsible>
          ) : null}

          <AgentDetailBody detailBody={detailBody} detailLoading={detailLoading} detailError={detailError} />
        </div>
      </section>
    </div>
  )
}

function AgentDetailSummary({ agent }: { agent: UnifiedBackgroundAgentSummary }) {
  return (
    <div className="agent-dock-detail-header agent-dock-detail-header--summary">
      <div className="agent-dock-detail-heading">
        <span className="agent-dock-detail-name" style={{ color: agentColorForId(agent.id) }}>
          {agent.name}
        </span>
        {agent.role ? <span className="agent-dock-detail-role">({agent.role})</span> : null}
        {agent.modelLabel ? <code className="agent-dock-detail-model">{agent.modelLabel}</code> : null}
      </div>
      <span className={`agent-dock-status agent-dock-status--${agent.status}`.trim()}>
        {agent.statusText}
      </span>
    </div>
  )
}

function AgentDetailBody({
  detailBody,
  detailLoading,
  detailError,
}: {
  detailBody?: ReactNode
  detailLoading?: boolean
  detailError?: string | null
}) {
  return (
    <div className="agent-dock-detail-body">
      {detailError ? <p className="agent-dock-detail-state agent-dock-detail-state--error">{detailError}</p> : null}
      {!detailError && detailLoading ? <p className="agent-dock-detail-state">Loading agent thread…</p> : null}
      {!detailError && !detailLoading && detailBody ? detailBody : null}
      {!detailError && !detailLoading && !detailBody ? (
        <p className="agent-dock-detail-state">
          This background agent has not produced any visible output yet.
        </p>
      ) : null}
    </div>
  )
}
