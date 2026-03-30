import type { ReactNode } from 'react'
import { Bot, ChevronDown, Columns, Rows, Shield, ShieldOff, X } from 'lucide-react'
import type { PermissionMode } from './claude-terminal-session-store'

type SplitMode = 'none' | 'horizontal' | 'vertical'

type ClaudeTerminalPaneViewProps = {
  directory: string
  unavailable: boolean
  permissionMode: PermissionMode
  rememberChoice: boolean
  onRememberChoiceChange: (checked: boolean) => void
  onPermissionChoice: (mode: 'standard' | 'full') => void
  onExit: () => void
  splitMode: SplitMode
  showSplitMenu: boolean
  onToggleSplitMenu: () => void
  onSplit: (mode: 'horizontal' | 'vertical') => void
  onUnsplit: () => void
  panelContent: ReactNode
}

export function ClaudeTerminalPaneView(props: ClaudeTerminalPaneViewProps) {
  if (props.unavailable) {
    return (
      <div className="claude-pane">
        <ClaudeTerminalToolbar directory={props.directory} onExit={props.onExit} />
        <div className="claude-unavailable">
          <Bot size={32} color="var(--text-muted)" />
          <span>Terminal API is not available in this environment.</span>
        </div>
      </div>
    )
  }

  if (props.permissionMode === 'pending') {
    return (
      <div className="claude-pane">
        <ClaudeTerminalToolbar directory={props.directory} onExit={props.onExit} />
        <div className="claude-permission-modal">
          <div className="claude-permission-content">
            <h3 className="claude-permission-title">Claude Code Permissions</h3>
            <p className="claude-permission-desc">Choose how Claude Code should run in this workspace.</p>
            <div className="claude-permission-options">
              <button type="button" className="claude-permission-option" onClick={() => props.onPermissionChoice('standard')}>
                <Shield size={20} />
                <span className="claude-permission-option-label">Standard Mode</span>
                <span className="claude-permission-option-desc">
                  Claude will ask for permission before executing commands or modifying files.
                </span>
              </button>
              <button
                type="button"
                className="claude-permission-option claude-permission-option--full"
                onClick={() => props.onPermissionChoice('full')}
              >
                <ShieldOff size={20} />
                <span className="claude-permission-option-label">Full Access Mode</span>
                <span className="claude-permission-option-desc">
                  Claude can execute commands and modify files without asking. Use with caution.
                </span>
              </button>
            </div>
            <label className="claude-permission-remember">
              <input type="checkbox" checked={props.rememberChoice} onChange={event => props.onRememberChoiceChange(event.target.checked)} />
              Remember this choice for this workspace
            </label>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="claude-pane">
      <div className="claude-toolbar">
        <Bot size={14} color="#8b5cf6" />
        <span className="claude-toolbar-label">claude code</span>
        <span className="claude-toolbar-path">{props.directory}</span>
        <div className="claude-toolbar-split-wrap">
          <button type="button" className="claude-toolbar-btn" onClick={props.onToggleSplitMenu} aria-label="split">
            <Columns size={11} />
            split
            <ChevronDown size={9} />
          </button>
          {props.showSplitMenu && (
            <div className="claude-split-menu">
              <button type="button" className="claude-split-menu-item" onClick={() => props.onSplit('horizontal')}>
                <Rows size={12} />
                Split horizontal
              </button>
              <button type="button" className="claude-split-menu-item" onClick={() => props.onSplit('vertical')}>
                <Columns size={12} />
                Split vertical
              </button>
              {props.splitMode !== 'none' && (
                <button type="button" className="claude-split-menu-item" onClick={props.onUnsplit}>
                  <X size={12} />
                  Unsplit
                </button>
              )}
            </div>
          )}
        </div>
        <button type="button" className="claude-toolbar-btn" onClick={props.onExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>
      {props.panelContent}
    </div>
  )
}

function ClaudeTerminalToolbar({ directory, onExit }: { directory: string; onExit: () => void }) {
  return (
    <div className="claude-toolbar">
      <Bot size={14} color="#8b5cf6" />
      <span className="claude-toolbar-label">claude code</span>
      <span className="claude-toolbar-path">{directory}</span>
      <button type="button" className="claude-toolbar-btn" onClick={onExit} aria-label="exit">
        <X size={11} />
        exit
      </button>
    </div>
  )
}
