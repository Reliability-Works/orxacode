import type { FileDiff, Part } from '@opencode-ai/sdk/v2/client'
import type { InternalEvent } from './message-feed-timeline'

export type ActivityEvent = {
  id: string
  label: string
}

export type DelegationTrace = {
  id: string
  agent: string
  description: string
  prompt: string
  modelLabel?: string
  command?: string
  sessionID?: string
  events: InternalEvent[]
}

export type TaskDelegationInfo = {
  agent: string
  description: string
  prompt: string
  command?: string
  modelLabel?: string
  sessionID?: string
}

export type SessionDiffLookup = {
  all: FileDiff[]
  byPath: Map<string, FileDiff[]>
}

export type AssistantClassificationResult = {
  visible: Part[]
  internal: InternalEvent[]
  delegations: DelegationTrace[]
  timeline: Array<{
    id: string
    label: string
    kind: string
    reason?: string
    command?: string
    output?: string
    failure?: string
  }>
  changedFiles: Array<{
    id: string
    kind: 'diff'
    path: string
    type: string
    diff?: string
    insertions?: number
    deletions?: number
  }>
  activity: ActivityEvent | null
}
