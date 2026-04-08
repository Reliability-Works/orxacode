import { CommandId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import { gitRefExists } from './OrchestrationEngineHarness.integration.ts'
import {
  nowIso,
  seedProjectAndThread,
  THREAD_ID,
  withHarness,
} from './orchestrationEngine.integration.helpers.ts'
import {
  queueClaudeTurnResponse,
  queueClaudeTurnResponseForNextSession,
  startClaudeTurn,
} from './orchestrationEngine.claude.integration.helpers.ts'
import { checkpointRefForThreadTurn } from '../src/checkpointing/Utils.ts'

it.live('reverts claudeAgent turns and rolls back provider conversation state', () =>
  withHarness(
    harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* queueClaudeTurnResponseForNextSession(harness, {
          startedEventId: 'evt-claude-revert-1',
          startedAt: '2026-02-24T10:14:00.000Z',
          deltaEventId: 'evt-claude-revert-2',
          deltaAt: '2026-02-24T10:14:00.050Z',
          delta: 'README -> v2\n',
          completedEventId: 'evt-claude-revert-3',
          completedAt: '2026-02-24T10:14:00.100Z',
          mutateReadmeTo: 'v2\n',
        })
        yield* startClaudeTurn(harness, {
          commandId: 'cmd-turn-start-claude-revert-1',
          messageId: 'msg-user-claude-revert-1',
          text: 'First Claude edit',
          selectModel: true,
        })
        yield* harness.waitForThread(
          THREAD_ID,
          entry => entry.latestTurn?.turnId === 'turn-1' && entry.session?.threadId === 'thread-1'
        )

        yield* queueClaudeTurnResponse(harness, {
          startedEventId: 'evt-claude-revert-4',
          startedAt: '2026-02-24T10:14:01.000Z',
          deltaEventId: 'evt-claude-revert-5',
          deltaAt: '2026-02-24T10:14:01.050Z',
          delta: 'README -> v3\n',
          completedEventId: 'evt-claude-revert-6',
          completedAt: '2026-02-24T10:14:01.100Z',
          mutateReadmeTo: 'v3\n',
        })
        yield* startClaudeTurn(harness, {
          commandId: 'cmd-turn-start-claude-revert-2',
          messageId: 'msg-user-claude-revert-2',
          text: 'Second Claude edit',
        })
        yield* harness.waitForThread(
          THREAD_ID,
          entry =>
            entry.latestTurn?.turnId === 'turn-2' &&
            entry.checkpoints.length === 2 &&
            entry.session?.providerName === 'claudeAgent'
        )

        yield* harness.engine.dispatch({
          type: 'thread.checkpoint.revert',
          commandId: CommandId.makeUnsafe('cmd-checkpoint-revert-claude'),
          threadId: THREAD_ID,
          turnCount: 1,
          createdAt: nowIso(),
        })

        const revertedThread = yield* harness.waitForThread(
          THREAD_ID,
          entry => entry.checkpoints.length === 1 && entry.checkpoints[0]?.checkpointTurnCount === 1
        )
        assert.equal(revertedThread.checkpoints[0]?.checkpointTurnCount, 1)
        assert.equal(
          gitRefExists(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 1)),
          true
        )
        assert.equal(
          gitRefExists(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 2)),
          false
        )
        assert.deepEqual(harness.adapterHarness!.getRollbackCalls(THREAD_ID), [1])
      }),
    'claudeAgent'
  )
)
