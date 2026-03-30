export type McpDevToolsServerState = 'stopped' | 'starting' | 'running' | 'error'

export type McpDevToolsServerStatus = {
  state: McpDevToolsServerState
  cdpPort?: number
  error?: string
}
