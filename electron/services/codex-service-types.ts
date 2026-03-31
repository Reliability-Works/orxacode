export interface CodexTurnItem {
  type: string
  id: string
  content?: Array<{ type: string; text?: string }>
  command?: string
  cwd?: string
  status?: string
  exitCode?: number
  aggregatedOutput?: string
  durationMs?: number
  [key: string]: unknown
}

export interface CodexTurn {
  id: string
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed'
  items: CodexTurnItem[]
  error?: string | null
  tokenUsage?: { input: number; output: number }
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
