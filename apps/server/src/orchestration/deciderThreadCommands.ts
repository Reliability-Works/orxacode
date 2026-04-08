import type { OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { OrchestrationCommandInvariantError } from './Errors.ts'
import type { OrchestrationDecisionOutput } from './deciderShared.ts'
import {
  decideThreadArchiveCommand,
  decideThreadCreateCommand,
  decideThreadDeleteCommand,
  decideThreadInteractionModeSetCommand,
  decideThreadMetaUpdateCommand,
  decideThreadRuntimeModeSetCommand,
  decideThreadSessionSetCommand,
  decideThreadSessionStopCommand,
  decideThreadUnarchiveCommand,
} from './deciderThreadLifecycleCommands.ts'
import {
  decideThreadApprovalRespondCommand,
  decideThreadCheckpointRevertCommand,
  decideThreadTurnInterruptCommand,
  decideThreadTurnStartCommand,
  decideThreadUserInputRespondCommand,
} from './deciderThreadTurnCommands.ts'
import type { ThreadCommand, ThreadCommandInput, ThreadCommandType } from './deciderThreadShared.ts'
import {
  decideThreadActivityAppendCommand,
  decideThreadAssistantCompleteCommand,
  decideThreadAssistantDeltaCommand,
  decideThreadProposedPlanUpsertCommand,
  decideThreadRevertCompleteCommand,
  decideThreadTurnDiffCompleteCommand,
} from './deciderThreadUpdateCommands.ts'

type ThreadHandler = (
  input: ThreadCommandInput
) => Effect.Effect<OrchestrationDecisionOutput, OrchestrationCommandInvariantError>

const THREAD_COMMAND_HANDLERS: Record<ThreadCommandType, ThreadHandler> = {
  'thread.create': input => decideThreadCreateCommand(input as ThreadCommandInput<'thread.create'>),
  'thread.delete': input => decideThreadDeleteCommand(input as ThreadCommandInput<'thread.delete'>),
  'thread.archive': input =>
    decideThreadArchiveCommand(input as ThreadCommandInput<'thread.archive'>),
  'thread.unarchive': input =>
    decideThreadUnarchiveCommand(input as ThreadCommandInput<'thread.unarchive'>),
  'thread.meta.update': input =>
    decideThreadMetaUpdateCommand(input as ThreadCommandInput<'thread.meta.update'>),
  'thread.runtime-mode.set': input =>
    decideThreadRuntimeModeSetCommand(input as ThreadCommandInput<'thread.runtime-mode.set'>),
  'thread.interaction-mode.set': input =>
    decideThreadInteractionModeSetCommand(
      input as ThreadCommandInput<'thread.interaction-mode.set'>
    ),
  'thread.turn.start': input =>
    decideThreadTurnStartCommand(input as ThreadCommandInput<'thread.turn.start'>),
  'thread.turn.interrupt': input =>
    decideThreadTurnInterruptCommand(input as ThreadCommandInput<'thread.turn.interrupt'>),
  'thread.approval.respond': input =>
    decideThreadApprovalRespondCommand(input as ThreadCommandInput<'thread.approval.respond'>),
  'thread.user-input.respond': input =>
    decideThreadUserInputRespondCommand(input as ThreadCommandInput<'thread.user-input.respond'>),
  'thread.checkpoint.revert': input =>
    decideThreadCheckpointRevertCommand(input as ThreadCommandInput<'thread.checkpoint.revert'>),
  'thread.session.stop': input =>
    decideThreadSessionStopCommand(input as ThreadCommandInput<'thread.session.stop'>),
  'thread.session.set': input =>
    decideThreadSessionSetCommand(input as ThreadCommandInput<'thread.session.set'>),
  'thread.message.assistant.delta': input =>
    decideThreadAssistantDeltaCommand(
      input as ThreadCommandInput<'thread.message.assistant.delta'>
    ),
  'thread.message.assistant.complete': input =>
    decideThreadAssistantCompleteCommand(
      input as ThreadCommandInput<'thread.message.assistant.complete'>
    ),
  'thread.proposed-plan.upsert': input =>
    decideThreadProposedPlanUpsertCommand(
      input as ThreadCommandInput<'thread.proposed-plan.upsert'>
    ),
  'thread.turn.diff.complete': input =>
    decideThreadTurnDiffCompleteCommand(input as ThreadCommandInput<'thread.turn.diff.complete'>),
  'thread.revert.complete': input =>
    decideThreadRevertCompleteCommand(input as ThreadCommandInput<'thread.revert.complete'>),
  'thread.activity.append': input =>
    decideThreadActivityAppendCommand(input as ThreadCommandInput<'thread.activity.append'>),
}

export function decideThreadCommand(input: {
  readonly command: ThreadCommand
  readonly readModel: OrchestrationReadModel
}) {
  const handler = THREAD_COMMAND_HANDLERS[input.command.type]
  if (handler) {
    return handler(input)
  }

  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: input.command.type,
      detail: `Unknown thread command type: ${input.command.type}`,
    })
  )
}
