import { useState, type ReactNode } from 'react'
import { GitBranch } from 'lucide-react'
import type { SessionType } from '../types/canvas'
import { OpenCodeLogo, OpenAILogo, AnthropicLogo, CanvasLogo } from './ProviderLogos'
import type { ActiveWorkspaceWorktree } from './WorkspaceDetail.types'

type WorkspaceLandingProps = {
  workspaceName: string
  onPickSession: (type: SessionType) => void
  activeWorkspaceWorktree?: ActiveWorkspaceWorktree | null
  onOpenWorkspaceDetail?: () => void
  onBrowseClaudeSessions?: () => void
  onBrowseCodexSessions?: () => void
}

const SESSION_OPTIONS: Array<{
  type: SessionType
  title: string
  subtitle: string
  logo: ReactNode
  accentClass: string
}> = [
  {
    type: 'opencode',
    title: 'OpenCode',
    subtitle: "Anomaly's OpenCode agent in the Orxa chat interface",
    logo: <OpenCodeLogo size={26} />,
    accentClass: 'landing-card--opencode',
  },
  {
    type: 'codex',
    title: 'Codex',
    subtitle: 'OpenAI Codex in the Orxa chat interface',
    logo: <OpenAILogo size={26} />,
    accentClass: 'landing-card--codex',
  },
  {
    type: 'claude-chat',
    title: 'Claude Code (Chat)',
    subtitle: "Anthropic's Claude Code in the Orxa chat interface",
    logo: <AnthropicLogo size={26} />,
    accentClass: 'landing-card--claude',
  },
  {
    type: 'claude',
    title: 'Claude Code (Terminal)',
    subtitle: 'Claude Code CLI terminal',
    logo: <AnthropicLogo size={26} />,
    accentClass: 'landing-card--claude',
  },
  {
    type: 'canvas',
    title: 'Canvas',
    subtitle: 'Free-form tiled workspace with multiple views',
    logo: <CanvasLogo size={26} />,
    accentClass: 'landing-card--canvas',
  },
]

export function WorkspaceLanding({
  workspaceName,
  onPickSession,
  activeWorkspaceWorktree,
  onOpenWorkspaceDetail,
  onBrowseClaudeSessions,
  onBrowseCodexSessions,
}: WorkspaceLandingProps) {
  const [hoveredType, setHoveredType] = useState<SessionType | null>(null)

  return (
    <div className="workspace-landing">
      <div className="workspace-landing-header">
        <h2 className="workspace-landing-title">{workspaceName}</h2>
        <p className="workspace-landing-subtitle">choose a session type to get started</p>
      </div>

      <div className="workspace-landing-cards">
        {SESSION_OPTIONS.map(opt => {
          const isHovered = hoveredType === opt.type
          const isInactive = hoveredType !== null && !isHovered
          return (
            <button
              key={opt.type}
              type="button"
              className={`workspace-landing-card ${opt.accentClass}${isHovered ? ' is-hovered' : ''}${isInactive ? ' is-inactive' : ''}`}
              onClick={() => onPickSession(opt.type)}
              onMouseEnter={() => setHoveredType(opt.type)}
              onMouseLeave={() => setHoveredType(null)}
            >
              <span className="landing-card-icon">{opt.logo}</span>
              <span className="landing-card-title">{opt.title}</span>
              <span className="landing-card-subtitle">{opt.subtitle}</span>
            </button>
          )
        })}
      </div>
      {onOpenWorkspaceDetail || onBrowseClaudeSessions || onBrowseCodexSessions ? (
        <div className="workspace-landing-secondary-actions">
          {onOpenWorkspaceDetail ? (
            <button
              type="button"
              className="workspace-landing-secondary-button"
              onClick={onOpenWorkspaceDetail}
              title={activeWorkspaceWorktree?.directory}
            >
              <GitBranch size={13} aria-hidden="true" />
              <span>
                Workspace details
                {activeWorkspaceWorktree?.label ? ` - ${activeWorkspaceWorktree.label}` : ''}
              </span>
            </button>
          ) : null}
          {onBrowseClaudeSessions ? (
            <button
              type="button"
              className="workspace-landing-secondary-button"
              onClick={onBrowseClaudeSessions}
            >
              Browse Claude sessions
            </button>
          ) : null}
          {onBrowseCodexSessions ? (
            <button
              type="button"
              className="workspace-landing-secondary-button"
              onClick={onBrowseCodexSessions}
            >
              Browse Codex threads
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
