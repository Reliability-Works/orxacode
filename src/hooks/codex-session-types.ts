import type { CodexState, CodexThread, CodexApprovalRequest, CodexUserInputRequest } from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { ExploreEntry } from '../lib/explore-utils'

export type CodexMessageRole = 'user' | 'assistant'

/** @deprecated Use CodexMessageItem instead */
export interface CodexMessage {
  id: string
  role: CodexMessageRole
  content: string
  timestamp: number
}

export type CodexMessageItem =
  | { id: string; kind: 'message'; role: 'user' | 'assistant'; content: string; timestamp: number }
  | { id: string; kind: 'status'; label: string; timestamp: number }
  | {
      id: string
      kind: 'tool'
      toolType: string
      title: string
      command?: string
      output?: string
      status: 'running' | 'completed' | 'error'
      exitCode?: number
      durationMs?: number
      timestamp: number
      /** Collab metadata for subagent task items */
      collabSender?: { threadId: string; nickname?: string; role?: string }
      collabReceivers?: Array<{ threadId: string; nickname?: string; role?: string }>
      collabStatuses?: Array<{ threadId: string; nickname?: string; role?: string; status: string }>
    }
  | {
      id: string
      kind: 'diff'
      path: string
      type: string
      status: 'running' | 'completed' | 'error'
      diff?: string
      insertions?: number
      deletions?: number
      timestamp: number
    }
  | { id: string; kind: 'thinking'; timestamp: number }
  | { id: string; kind: 'reasoning'; content: string; summary: string; timestamp: number }
  | {
      id: string
      kind: 'context'
      toolType: string
      title: string
      detail?: string
      status: 'running' | 'completed' | 'error'
      timestamp: number
    }
  | { id: string; kind: 'compaction'; timestamp: number }
  | {
      id: string
      kind: 'explore'
      status: 'exploring' | 'explored'
      entries: ExploreEntry[]
      timestamp: number
    }

export interface CodexSessionState {
  connectionStatus: CodexState['status']
  serverInfo?: CodexState['serverInfo']
  thread: CodexThread | null
  messages: CodexMessageItem[]
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  isStreaming: boolean
  lastError?: string
  threadName?: string
  planItems: TodoItem[]
}
