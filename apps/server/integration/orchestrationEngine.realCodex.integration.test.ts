import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { CommandId } from '@orxa-code/contracts'

import {
  asMessageId,
  nowIso,
  PROJECT_ID,
  startTurn,
  THREAD_ID,
  withRealCodexHarness,
} from './orchestrationEngine.integration.helpers.ts'
import { DEFAULT_PROVIDER_INTERACTION_MODE } from '@orxa-code/contracts'

const createRealCodexProject = (workspaceDir: string) => ({
  type: 'project.create' as const,
  commandId: CommandId.makeUnsafe('cmd-project-create-real-codex'),
  projectId: PROJECT_ID,
  title: 'Integration Project',
  workspaceRoot: workspaceDir,
  defaultModelSelection: {
    provider: 'codex' as const,
    model: 'gpt-5.3-codex',
  },
  createdAt: nowIso(),
})

const createRealCodexThread = (
  workspaceDir: string,
  runtimeMode: 'full-access' | 'approval-required'
) => ({
  type: 'thread.create' as const,
  commandId: CommandId.makeUnsafe('cmd-thread-create-real-codex'),
  threadId: THREAD_ID,
  projectId: PROJECT_ID,
  title: 'Integration Thread',
  modelSelection: {
    provider: 'codex' as const,
    model: 'gpt-5.3-codex',
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode,
  branch: null,
  worktreePath: workspaceDir,
  gitRoot: null,
  createdAt: nowIso(),
})

it.live.skipIf(!process.env.CODEX_BINARY_PATH)(
  'keeps the same Codex provider thread across runtime mode switches',
  () =>
    withRealCodexHarness(harness =>
      Effect.gen(function* () {
        yield* harness.engine.dispatch(createRealCodexProject(harness.workspaceDir))
        yield* harness.engine.dispatch(createRealCodexThread(harness.workspaceDir, 'full-access'))

        yield* harness.engine.dispatch({
          type: 'thread.turn.start',
          commandId: CommandId.makeUnsafe('cmd-turn-start-real-codex-1'),
          threadId: THREAD_ID,
          message: {
            messageId: asMessageId('msg-real-codex-1'),
            role: 'user',
            text: 'Reply with exactly ALPHA.',
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: 'full-access',
          createdAt: nowIso(),
        })

        const firstThread = yield* harness.waitForThread(
          THREAD_ID,
          entry =>
            entry.session?.status === 'ready' &&
            entry.session.providerName === 'codex' &&
            entry.messages.some(
              message => message.role === 'assistant' && message.streaming === false
            ),
          180_000
        )
        assert.equal(firstThread.session?.threadId, 'thread-1')

        yield* startTurn({
          harness,
          commandId: 'cmd-turn-start-real-codex-2',
          messageId: 'msg-real-codex-2',
          text: 'Reply with exactly BETA.',
        })

        const secondThread = yield* harness.waitForThread(
          THREAD_ID,
          entry =>
            entry.session?.status === 'ready' &&
            entry.session.providerName === 'codex' &&
            entry.session.runtimeMode === 'approval-required' &&
            entry.messages.some(
              message => message.role === 'assistant' && message.text.includes('BETA')
            ),
          180_000
        )
        assert.equal(secondThread.session?.threadId, 'thread-1')
      })
    )
)
