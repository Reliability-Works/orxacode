import type { ComponentProps } from 'react'
import { CanvasPane } from './components/CanvasPane'
import { WorkspaceLanding } from './components/WorkspaceLanding'
import { ClaudeChatPane } from './components/ClaudeChatPane'
import { ClaudeTerminalPane } from './components/ClaudeTerminalPane'
import { CodexPane } from './components/CodexPane'
import { HomeDashboard } from './components/HomeDashboard'
import { SkillsBoard } from './components/SkillsBoard'
import { KanbanBoard } from './components/KanbanBoard'
import { MessageFeed } from './components/MessageFeed'
import { ComposerPanel } from './components/ComposerPanel'
import { TerminalPanel } from './components/TerminalPanel'
import type { SessionType } from '~/types/canvas'

export type AppSessionContentProps = {
  sidebarMode: 'projects' | 'kanban' | 'skills'
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  activeSessionType: SessionType | undefined
  pendingSessionId: string | undefined
  dashboardProps: ComponentProps<typeof HomeDashboard>
  skillsProps: ComponentProps<typeof SkillsBoard>
  workspaceLandingProps: ComponentProps<typeof WorkspaceLanding>
  canvasPaneProps: ComponentProps<typeof CanvasPane>
  claudeChatPaneProps: ComponentProps<typeof ClaudeChatPane>
  claudeTerminalPaneProps: ComponentProps<typeof ClaudeTerminalPane>
  codexPaneProps: ComponentProps<typeof CodexPane>
  messageFeedProps: ComponentProps<typeof MessageFeed>
  composerPanelProps: ComponentProps<typeof ComposerPanel>
  terminalPanelProps?: ComponentProps<typeof TerminalPanel>
}

function ProjectSessionSurface(props: AppSessionContentProps) {
  const {
    activeProjectDir,
    activeSessionID,
    activeSessionType,
    pendingSessionId,
    workspaceLandingProps,
    canvasPaneProps,
    claudeChatPaneProps,
    claudeTerminalPaneProps,
    codexPaneProps,
    messageFeedProps,
    composerPanelProps,
    terminalPanelProps,
  } = props

  if (!activeProjectDir) {
    return null
  }
  if (!activeSessionID) {
    if (pendingSessionId) {
      return (
        <div className="workspace-session-transition" aria-live="polite">
          Opening session...
        </div>
      )
    }
    return <WorkspaceLanding {...workspaceLandingProps} />
  }
  if (activeSessionType === 'canvas') {
    return <CanvasPane {...canvasPaneProps} />
  }
  if (activeSessionType === 'claude-chat') {
    return <ClaudeChatPane {...claudeChatPaneProps} />
  }
  if (activeSessionType === 'claude') {
    return <ClaudeTerminalPane {...claudeTerminalPaneProps} />
  }
  if (activeSessionType === 'codex') {
    return <CodexPane key={codexPaneProps.sessionStorageKey} {...codexPaneProps} />
  }
  return (
    <>
      <MessageFeed {...messageFeedProps} />
      <div className="center-pane-rail center-pane-rail--composer">
        <ComposerPanel {...composerPanelProps} />
      </div>
      {terminalPanelProps ? <TerminalPanel {...terminalPanelProps} /> : null}
    </>
  )
}

export function AppSessionContent(props: AppSessionContentProps) {
  if (props.sidebarMode === 'kanban') {
    return <KanbanBoard />
  }
  if (props.sidebarMode === 'skills') {
    return <SkillsBoard {...props.skillsProps} />
  }
  if (!props.activeProjectDir) {
    return <HomeDashboard {...props.dashboardProps} />
  }
  return <ProjectSessionSurface {...props} />
}
