import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from '@orxa-code/contracts'
import { memo } from 'react'
import GitActionsControl from '../GitActionsControl'
import { DiffIcon, TerminalSquareIcon } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import ProjectScriptsControl, { type NewProjectScriptInput } from '../ProjectScriptsControl'
import { Toggle } from '../ui/toggle'
import { SidebarTrigger } from '../ui/sidebar'
import { OpenInPicker } from './OpenInPicker'

interface ProjectActionProps {
  activeThreadId: ThreadId
  activeProjectName: string | undefined
  activeProjectScripts: ProjectScript[] | undefined
  preferredScriptId: string | null
  keybindings: ResolvedKeybindingsConfig
  availableEditors: ReadonlyArray<EditorId>
  openInCwd: string | null
  gitCwd: string | null
  onRunProjectScript: (script: ProjectScript) => void
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>
  onDeleteProjectScript: (scriptId: string) => Promise<void>
}

interface ChatHeaderProps extends ProjectActionProps {
  activeThreadTitle: string
  isGitRepo: boolean
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleShortcutLabel: string | null
  diffToggleShortcutLabel: string | null
  diffOpen: boolean
  onToggleTerminal: () => void
  onToggleDiff: () => void
}

function ChatHeaderTitle(props: {
  activeThreadTitle: string
  activeProjectName: string | undefined
  isGitRepo: boolean
}) {
  const { activeThreadTitle, activeProjectName, isGitRepo } = props
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
      <SidebarTrigger className="size-7 shrink-0 md:hidden" />
      <h2
        className="min-w-0 shrink truncate text-sm font-medium text-foreground"
        title={activeThreadTitle}
      >
        {activeThreadTitle}
      </h2>
      {activeProjectName && (
        <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
          <span className="min-w-0 truncate">{activeProjectName}</span>
        </Badge>
      )}
      {activeProjectName && !isGitRepo && (
        <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
          No Git
        </Badge>
      )}
    </div>
  )
}

function HeaderToggleControl(props: {
  pressed: boolean
  onToggle: () => void
  disabled: boolean
  ariaLabel: string
  icon: React.ComponentType<{ className?: string }>
  tooltipLabel: string
}) {
  const { pressed, onToggle, disabled, ariaLabel, icon: Icon, tooltipLabel } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            pressed={pressed}
            onPressedChange={onToggle}
            aria-label={ariaLabel}
            variant="outline"
            size="xs"
            disabled={disabled}
          >
            <Icon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
    </Tooltip>
  )
}

function ChatHeaderProjectActions(props: ProjectActionProps) {
  const {
    activeThreadId,
    activeProjectName,
    activeProjectScripts,
    preferredScriptId,
    keybindings,
    availableEditors,
    openInCwd,
    gitCwd,
    onRunProjectScript,
    onAddProjectScript,
    onUpdateProjectScript,
    onDeleteProjectScript,
  } = props

  return (
    <>
      {activeProjectScripts && (
        <ProjectScriptsControl
          scripts={activeProjectScripts}
          keybindings={keybindings}
          preferredScriptId={preferredScriptId}
          onRunScript={onRunProjectScript}
          onAddScript={onAddProjectScript}
          onUpdateScript={onUpdateProjectScript}
          onDeleteScript={onDeleteProjectScript}
        />
      )}
      {activeProjectName && (
        <OpenInPicker
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={openInCwd}
        />
      )}
      {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />}
    </>
  )
}

function ChatHeaderToggleActions(props: {
  terminalOpen: boolean
  onToggleTerminal: () => void
  terminalAvailable: boolean
  terminalToggleLabel: string
  diffOpen: boolean
  onToggleDiff: () => void
  isGitRepo: boolean
  diffToggleLabel: string
}) {
  const {
    terminalOpen,
    onToggleTerminal,
    terminalAvailable,
    terminalToggleLabel,
    diffOpen,
    onToggleDiff,
    isGitRepo,
    diffToggleLabel,
  } = props
  return (
    <>
      <HeaderToggleControl
        pressed={terminalOpen}
        onToggle={onToggleTerminal}
        disabled={!terminalAvailable}
        ariaLabel="Toggle terminal drawer"
        icon={TerminalSquareIcon}
        tooltipLabel={terminalToggleLabel}
      />
      <HeaderToggleControl
        pressed={diffOpen}
        onToggle={onToggleDiff}
        disabled={!isGitRepo}
        ariaLabel="Toggle diff panel"
        icon={DiffIcon}
        tooltipLabel={diffToggleLabel}
      />
    </>
  )
}

interface ChatHeaderActionsProps extends ProjectActionProps {
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  diffOpen: boolean
  diffToggleLabel: string
  isGitRepo: boolean
  onToggleTerminal: () => void
  onToggleDiff: () => void
}

function ChatHeaderActions(props: ChatHeaderActionsProps) {
  const {
    activeThreadId,
    activeProjectName,
    activeProjectScripts,
    preferredScriptId,
    keybindings,
    availableEditors,
    openInCwd,
    gitCwd,
    terminalAvailable,
    terminalOpen,
    terminalToggleLabel,
    diffOpen,
    diffToggleLabel,
    isGitRepo,
    onRunProjectScript,
    onAddProjectScript,
    onUpdateProjectScript,
    onDeleteProjectScript,
    onToggleTerminal,
    onToggleDiff,
  } = props

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
      <ChatHeaderProjectActions
        activeThreadId={activeThreadId}
        activeProjectName={activeProjectName}
        activeProjectScripts={activeProjectScripts}
        preferredScriptId={preferredScriptId}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInCwd={openInCwd}
        gitCwd={gitCwd}
        onRunProjectScript={onRunProjectScript}
        onAddProjectScript={onAddProjectScript}
        onUpdateProjectScript={onUpdateProjectScript}
        onDeleteProjectScript={onDeleteProjectScript}
      />
      <ChatHeaderToggleActions
        terminalOpen={terminalOpen}
        onToggleTerminal={onToggleTerminal}
        terminalAvailable={terminalAvailable}
        terminalToggleLabel={terminalToggleLabel}
        diffOpen={diffOpen}
        onToggleDiff={onToggleDiff}
        isGitRepo={isGitRepo}
        diffToggleLabel={diffToggleLabel}
      />
    </div>
  )
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const terminalToggleLabel = !terminalAvailable
    ? 'Terminal is unavailable until this thread has an active project.'
    : terminalToggleShortcutLabel
      ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
      : 'Toggle terminal drawer'
  const diffToggleLabel = !isGitRepo
    ? 'Diff panel is unavailable because this project is not a git repository.'
    : diffToggleShortcutLabel
      ? `Toggle diff panel (${diffToggleShortcutLabel})`
      : 'Toggle diff panel'

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <ChatHeaderTitle
        activeThreadTitle={activeThreadTitle}
        activeProjectName={activeProjectName}
        isGitRepo={isGitRepo}
      />
      <ChatHeaderActions
        activeThreadId={activeThreadId}
        activeProjectName={activeProjectName}
        activeProjectScripts={activeProjectScripts}
        preferredScriptId={preferredScriptId}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInCwd={openInCwd}
        gitCwd={gitCwd}
        terminalAvailable={terminalAvailable}
        terminalOpen={terminalOpen}
        terminalToggleLabel={terminalToggleLabel}
        diffOpen={diffOpen}
        diffToggleLabel={diffToggleLabel}
        isGitRepo={isGitRepo}
        onRunProjectScript={onRunProjectScript}
        onAddProjectScript={onAddProjectScript}
        onUpdateProjectScript={onUpdateProjectScript}
        onDeleteProjectScript={onDeleteProjectScript}
        onToggleTerminal={onToggleTerminal}
        onToggleDiff={onToggleDiff}
      />
    </div>
  )
})
