import type { McpDevToolsServerState } from '@shared/ipc'

interface McpStatusIndicatorProps {
  state: McpDevToolsServerState
  className?: string
}

const STATE_CONFIG: Record<
  McpDevToolsServerState,
  { dotClass: string; label: string; title: string }
> = {
  stopped: {
    dotClass: 'mcp-dot-stopped',
    label: 'mcp off',
    title: 'MCP DevTools server is stopped',
  },
  starting: {
    dotClass: 'mcp-dot-starting',
    label: 'connecting',
    title: 'MCP DevTools server is starting',
  },
  running: { dotClass: 'mcp-dot-running', label: 'mcp', title: 'MCP DevTools server is connected' },
  error: {
    dotClass: 'mcp-dot-error',
    label: 'mcp error',
    title: 'MCP DevTools server encountered an error',
  },
}

export function McpStatusIndicator({ state, className }: McpStatusIndicatorProps) {
  const config = STATE_CONFIG[state]
  return (
    <span className={`mcp-status-indicator ${className ?? ''}`.trim()} title={config.title}>
      <span className={`mcp-status-dot ${config.dotClass}`} aria-hidden="true" />
      <span className="mcp-status-label">{config.label}</span>
    </span>
  )
}
