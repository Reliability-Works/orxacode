import type { EventId, ProviderKind, ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  ProjectId,
  ThreadId as ThreadIdBrand,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'

export type LegacyProviderRuntimeEvent = {
  readonly type: string
  readonly eventId: EventId
  readonly provider: ProviderKind
  readonly createdAt: string
  readonly threadId: ThreadId
  readonly turnId?: string | undefined
  readonly itemId?: string | undefined
  readonly requestId?: string | undefined
  readonly payload?: unknown | undefined
  readonly [key: string]: unknown
}

const unsupportedProviderCall = () =>
  Effect.die(new Error('Unsupported provider call in test')) as never

export const unsupportedProviderMethods = {
  startSession: unsupportedProviderCall,
  sendTurn: unsupportedProviderCall,
  interruptTurn: unsupportedProviderCall,
  respondToRequest: unsupportedProviderCall,
  respondToUserInput: unsupportedProviderCall,
  stopSession: unsupportedProviderCall,
} as const

export interface SeedProjectAndThreadInput {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly workspaceRoot: string
  readonly threadId: ThreadId
  readonly threadTitle: string
  readonly modelSelection: ModelSelection
  readonly runtimeMode: 'approval-required' | 'full-access'
  readonly worktreePath: string | null
  readonly createdAt: string
}

export async function dispatchProjectAndThreadCreate(
  engine: OrchestrationEngineShape,
  input: SeedProjectAndThreadInput
): Promise<void> {
  await Effect.runPromise(
    engine.dispatch({
      type: 'project.create',
      commandId: CommandId.makeUnsafe('cmd-project-create'),
      projectId: input.projectId,
      title: input.projectTitle,
      workspaceRoot: input.workspaceRoot,
      defaultModelSelection: input.modelSelection,
      createdAt: input.createdAt,
    })
  )
  await Effect.runPromise(
    engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe('cmd-thread-create'),
      threadId: input.threadId,
      projectId: input.projectId,
      title: input.threadTitle,
      modelSelection: input.modelSelection,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: input.runtimeMode,
      branch: null,
      worktreePath: input.worktreePath,
      gitRoot: null,
      createdAt: input.createdAt,
    })
  )
}

export const makeTestProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const makeTestThreadId = (value: string): ThreadId => ThreadIdBrand.makeUnsafe(value)

export type { ProviderRuntimeEvent }
