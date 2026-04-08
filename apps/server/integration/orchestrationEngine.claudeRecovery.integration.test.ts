import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  seedProjectAndThread,
  THREAD_ID,
  waitForSync,
  withHarness,
} from './orchestrationEngine.integration.helpers.ts'
import {
  queueClaudeTurnResponseForNextSession,
  startClaudeTurn,
} from './orchestrationEngine.claude.integration.helpers.ts'

it.live('recovers claudeAgent sessions after provider stopAll using persisted resume state', () =>
  withHarness(
    harness =>
      Effect.gen(function* () {
        yield* seedProjectAndThread(harness)

        yield* queueClaudeTurnResponseForNextSession(harness, {
          startedEventId: 'evt-claude-recover-1',
          startedAt: '2026-02-24T10:11:00.000Z',
          deltaEventId: 'evt-claude-recover-2',
          deltaAt: '2026-02-24T10:11:00.050Z',
          delta: 'Turn before restart.\n',
          completedEventId: 'evt-claude-recover-3',
          completedAt: '2026-02-24T10:11:00.100Z',
        })
        yield* startClaudeTurn(harness, {
          commandId: 'cmd-turn-start-claude-recover-1',
          messageId: 'msg-user-claude-recover-1',
          text: 'Before restart',
          selectModel: true,
        })
        yield* harness.waitForThread(
          THREAD_ID,
          entry => entry.latestTurn?.turnId === 'turn-1' && entry.session?.threadId === 'thread-1'
        )

        yield* harness.adapterHarness!.adapter.stopAll()
        yield* waitForSync(
          () => harness.adapterHarness!.listActiveSessionIds(),
          sessionIds => sessionIds.length === 0,
          'provider stopAll'
        )

        yield* queueClaudeTurnResponseForNextSession(harness, {
          startedEventId: 'evt-claude-recover-4',
          startedAt: '2026-02-24T10:11:01.000Z',
          deltaEventId: 'evt-claude-recover-5',
          deltaAt: '2026-02-24T10:11:01.050Z',
          delta: 'Turn after restart.\n',
          completedEventId: 'evt-claude-recover-6',
          completedAt: '2026-02-24T10:11:01.100Z',
        })
        yield* startClaudeTurn(harness, {
          commandId: 'cmd-turn-start-claude-recover-2',
          messageId: 'msg-user-claude-recover-2',
          text: 'After restart',
        })

        yield* waitForSync(
          () => harness.adapterHarness!.getStartCount(),
          count => count === 2,
          'claude provider recovery start'
        )

        const recoveredThread = yield* harness.waitForThread(
          THREAD_ID,
          entry =>
            entry.session?.providerName === 'claudeAgent' &&
            entry.messages.some(
              message => message.role === 'user' && message.text === 'After restart'
            ) &&
            !entry.activities.some(activity => activity.kind === 'provider.turn.start.failed')
        )
        assert.equal(recoveredThread.session?.providerName, 'claudeAgent')
        assert.equal(recoveredThread.session?.threadId, 'thread-1')
      }),
    'claudeAgent'
  )
)
