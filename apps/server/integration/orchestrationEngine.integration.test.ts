import { CommandId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { gitRefExists } from './OrchestrationEngineHarness.integration.ts'
import {
  APPROVAL_REQUEST_ID,
  FIXTURE_TURN_ID,
  nowIso,
  runtimeBase,
  seedProjectAndThread,
  startTurn,
  THREAD_ID,
  waitForSync,
  withHarness,
} from './orchestrationEngine.integration.helpers.ts'
import { checkpointRefForThreadTurn } from '../src/checkpointing/Utils.ts'

it.live('records failed turn runtime state and checkpoint status as error', () =>
  withHarness(harness =>
    Effect.gen(function* () {
      yield* seedProjectAndThread(harness)

      yield* harness.adapterHarness!.queueTurnResponseForNextSession({
        events: [
          {
            type: 'turn.started',
            ...runtimeBase('evt-failure-1', '2026-02-24T10:04:00.000Z'),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
          },
          {
            type: 'content.delta',
            ...runtimeBase('evt-failure-2', '2026-02-24T10:04:00.100Z'),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
            payload: {
              streamKind: 'assistant_text',
              delta: 'Partial output before failure.\n',
            },
          },
          {
            type: 'runtime.error',
            ...runtimeBase('evt-failure-3', '2026-02-24T10:04:00.200Z'),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
            payload: {
              message: 'Sandbox command failed.',
            },
          },
          {
            type: 'turn.completed',
            ...runtimeBase('evt-failure-4', '2026-02-24T10:04:00.300Z'),
            threadId: THREAD_ID,
            turnId: FIXTURE_TURN_ID,
            payload: {
              state: 'failed',
              errorMessage: 'Sandbox command failed.',
            },
          },
        ],
      })

      yield* startTurn({
        harness,
        commandId: 'cmd-turn-start-failure',
        messageId: 'msg-user-failure',
        text: 'Run risky command',
      })

      const thread = yield* harness.waitForThread(
        THREAD_ID,
        entry =>
          entry.session?.status === 'error' &&
          entry.session?.lastError === 'Sandbox command failed.' &&
          entry.activities.some(activity => activity.kind === 'runtime.error') &&
          entry.checkpoints.length === 1
      )
      assert.equal(thread.session?.status, 'error')
      assert.equal(thread.checkpoints[0]?.status, 'error')

      const checkpointRow = yield* harness.checkpointRepository.getByThreadAndTurnCount({
        threadId: THREAD_ID,
        checkpointTurnCount: 1,
      })
      assert.equal(Option.isSome(checkpointRow), true)
      if (Option.isSome(checkpointRow)) {
        assert.equal(checkpointRow.value.status, 'error')
      }
      assert.equal(
        gitRefExists(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 1)),
        true
      )
    })
  )
)

it.live(
  'appends checkpoint.revert.failed activity when revert is requested without an active session',
  () =>
    withHarness(harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* harness.engine.dispatch({
          type: 'thread.checkpoint.revert',
          commandId: CommandId.makeUnsafe('cmd-checkpoint-revert-no-session'),
          threadId: THREAD_ID,
          turnCount: 0,
          createdAt: nowIso(),
        })

        const thread = yield* harness.waitForThread(THREAD_ID, entry =>
          entry.activities.some(
            activity =>
              activity.kind === 'checkpoint.revert.failed' &&
              typeof activity.payload === 'object' &&
              activity.payload !== null
          )
        )
        const failureActivity = thread.activities.find(
          activity => activity.kind === 'checkpoint.revert.failed'
        )
        assert.equal(failureActivity !== undefined, true)
        assert.equal(
          String(
            (failureActivity?.payload as { readonly detail?: string } | undefined)?.detail
          ).includes('No active provider session'),
          true
        )
      })
    )
)

it.live('starts a claudeAgent session on first turn when provider is requested', () =>
  withHarness(
    harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* harness.adapterHarness!.queueTurnResponseForNextSession({
          events: [
            {
              type: 'turn.started',
              ...runtimeBase('evt-claude-start-1', '2026-02-24T10:10:00.000Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
            },
            {
              type: 'message.delta',
              ...runtimeBase('evt-claude-start-2', '2026-02-24T10:10:00.050Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              delta: 'Claude first turn.\n',
            },
            {
              type: 'turn.completed',
              ...runtimeBase('evt-claude-start-3', '2026-02-24T10:10:00.100Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              status: 'completed',
            },
          ],
        })

        yield* startTurn({
          harness,
          commandId: 'cmd-turn-start-claude-initial',
          messageId: 'msg-user-claude-initial',
          text: 'Use Claude',
          modelSelection: {
            provider: 'claudeAgent',
            model: 'claude-sonnet-4-6',
          },
        })

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          entry =>
            entry.session?.providerName === 'claudeAgent' &&
            entry.session.status === 'ready' &&
            entry.messages.some(
              message => message.role === 'assistant' && message.text === 'Claude first turn.\n'
            )
        )
        assert.equal(thread.session?.providerName, 'claudeAgent')
      }),
    'claudeAgent'
  )
)

it.live('forwards claudeAgent approval responses to the provider session', () =>
  withHarness(
    harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* harness.adapterHarness!.queueTurnResponseForNextSession({
          events: [
            {
              type: 'turn.started',
              ...runtimeBase('evt-claude-approval-1', '2026-02-24T10:12:00.000Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
            },
            {
              type: 'approval.requested',
              ...runtimeBase('evt-claude-approval-2', '2026-02-24T10:12:00.050Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              requestId: APPROVAL_REQUEST_ID,
              requestKind: 'command',
              detail: 'Approve Claude tool call',
            },
            {
              type: 'turn.completed',
              ...runtimeBase('evt-claude-approval-3', '2026-02-24T10:12:00.100Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              status: 'completed',
            },
          ],
        })

        yield* startTurn({
          harness,
          commandId: 'cmd-turn-start-claude-approval',
          messageId: 'msg-user-claude-approval',
          text: 'Need approval',
          modelSelection: {
            provider: 'claudeAgent',
            model: 'claude-sonnet-4-6',
          },
        })

        const thread = yield* harness.waitForThread(THREAD_ID, entry =>
          entry.activities.some(activity => activity.kind === 'approval.requested')
        )
        assert.equal(thread.session?.threadId, 'thread-1')

        yield* harness.engine.dispatch({
          type: 'thread.approval.respond',
          commandId: CommandId.makeUnsafe('cmd-claude-approval-respond'),
          threadId: THREAD_ID,
          requestId: APPROVAL_REQUEST_ID,
          decision: 'accept',
          createdAt: nowIso(),
        })

        yield* harness.waitForPendingApproval(
          'req-approval-1',
          row => row.status === 'resolved' && row.decision === 'accept'
        )

        const approvalResponses = yield* waitForSync(
          () => harness.adapterHarness!.getApprovalResponses(THREAD_ID),
          responses => responses.length === 1,
          'claude provider approval response'
        )
        assert.equal(approvalResponses[0]?.decision, 'accept')
      }),
    'claudeAgent'
  )
)

it.live('forwards thread.turn.interrupt to claudeAgent provider sessions', () =>
  withHarness(
    harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* harness.adapterHarness!.queueTurnResponseForNextSession({
          events: [
            {
              type: 'turn.started',
              ...runtimeBase('evt-claude-interrupt-1', '2026-02-24T10:13:00.000Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
            },
            {
              type: 'message.delta',
              ...runtimeBase('evt-claude-interrupt-2', '2026-02-24T10:13:00.050Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              delta: 'Long running output.\n',
            },
            {
              type: 'turn.completed',
              ...runtimeBase('evt-claude-interrupt-3', '2026-02-24T10:13:00.100Z', 'claudeAgent'),
              threadId: THREAD_ID,
              turnId: FIXTURE_TURN_ID,
              status: 'completed',
            },
          ],
        })

        yield* startTurn({
          harness,
          commandId: 'cmd-turn-start-claude-interrupt',
          messageId: 'msg-user-claude-interrupt',
          text: 'Start long turn',
          modelSelection: {
            provider: 'claudeAgent',
            model: 'claude-sonnet-4-6',
          },
        })

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          entry => entry.session?.threadId === 'thread-1'
        )
        assert.equal(thread.session?.threadId, 'thread-1')

        yield* harness.engine.dispatch({
          type: 'thread.turn.interrupt',
          commandId: CommandId.makeUnsafe('cmd-turn-interrupt-claude'),
          threadId: THREAD_ID,
          createdAt: nowIso(),
        })
        yield* harness.waitForDomainEvent(event => event.type === 'thread.turn-interrupt-requested')

        const interruptCalls = yield* waitForSync(
          () => harness.adapterHarness!.getInterruptCalls(THREAD_ID),
          calls => calls.length === 1,
          'claude provider interrupt call'
        )
        assert.equal(interruptCalls.length, 1)
      }),
    'claudeAgent'
  )
)
