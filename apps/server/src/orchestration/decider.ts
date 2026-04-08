import type { OrchestrationCommand, OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { OrchestrationCommandInvariantError } from './Errors.ts'
import { decideProjectCommand } from './deciderProjectCommands.ts'
import { decideThreadCommand } from './deciderThreadCommands.ts'
import type { OrchestrationDecisionOutput } from './deciderShared.ts'

type ProjectCommandType = 'project.create' | 'project.meta.update' | 'project.delete'
type ThreadCommandType =
  | 'thread.create'
  | 'thread.delete'
  | 'thread.archive'
  | 'thread.unarchive'
  | 'thread.meta.update'
  | 'thread.runtime-mode.set'
  | 'thread.interaction-mode.set'
  | 'thread.turn.start'
  | 'thread.turn.interrupt'
  | 'thread.approval.respond'
  | 'thread.user-input.respond'
  | 'thread.checkpoint.revert'
  | 'thread.session.stop'
  | 'thread.session.set'
  | 'thread.message.assistant.delta'
  | 'thread.message.assistant.complete'
  | 'thread.proposed-plan.upsert'
  | 'thread.turn.diff.complete'
  | 'thread.revert.complete'
  | 'thread.activity.append'

const PROJECT_COMMAND_TYPES = new Set<ProjectCommandType>([
  'project.create',
  'project.meta.update',
  'project.delete',
])
const THREAD_COMMAND_TYPES = new Set<ThreadCommandType>([
  'thread.create',
  'thread.delete',
  'thread.archive',
  'thread.unarchive',
  'thread.meta.update',
  'thread.runtime-mode.set',
  'thread.interaction-mode.set',
  'thread.turn.start',
  'thread.turn.interrupt',
  'thread.approval.respond',
  'thread.user-input.respond',
  'thread.checkpoint.revert',
  'thread.session.stop',
  'thread.session.set',
  'thread.message.assistant.delta',
  'thread.message.assistant.complete',
  'thread.proposed-plan.upsert',
  'thread.turn.diff.complete',
  'thread.revert.complete',
  'thread.activity.append',
])

function isProjectCommand(
  command: OrchestrationCommand
): command is Extract<OrchestrationCommand, { type: ProjectCommandType }> {
  return PROJECT_COMMAND_TYPES.has(command.type as ProjectCommandType)
}

function isThreadCommand(
  command: OrchestrationCommand
): command is Extract<OrchestrationCommand, { type: ThreadCommandType }> {
  return THREAD_COMMAND_TYPES.has(command.type as ThreadCommandType)
}

export const decideOrchestrationCommand = Effect.fn('decideOrchestrationCommand')(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand
  readonly readModel: OrchestrationReadModel
}): Effect.fn.Return<OrchestrationDecisionOutput, OrchestrationCommandInvariantError> {
  if (isProjectCommand(command)) {
    return yield* decideProjectCommand({ command, readModel })
  }

  if (isThreadCommand(command)) {
    return yield* decideThreadCommand({ command, readModel })
  }

  command satisfies never
  const fallback = command as never as { type: string }
  return yield* new OrchestrationCommandInvariantError({
    commandType: fallback.type,
    detail: `Unknown command type: ${fallback.type}`,
  })
})
