import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Effect } from 'effect'
import { CommandId, RuntimeItemId, type ProviderRuntimeEvent } from '@orxa-code/contracts'
import {
  asEventId,
  asThreadId,
  asTurnId,
  createHarness,
  createRuntimeRefs,
  disposeRuntimeRefs,
  waitForThread,
} from './ProviderRuntimeIngestion.test.helpers.ts'
import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'

const refs = createRuntimeRefs()
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

afterEach(async () => {
  process.env.XDG_CONFIG_HOME = originalXdgConfigHome
  await disposeRuntimeRefs(refs)
})

const asCommandId = (value: string): CommandId => CommandId.makeUnsafe(value)
const asRuntimeItemId = (value: string): RuntimeItemId => RuntimeItemId.makeUnsafe(value)
const PARENT_THREAD_ID = asThreadId('thread-1')
const OPENCODE_ROOT_TURN_ID = asTurnId('turn-root')
const OPENCODE_DELEGATED_PROMPT =
  'Inspect the provider runtime and summarize the session-routing gaps.'
const OPENCODE_DELEGATED_DESCRIPTION = 'Audit the runtime and report one inconsistency.'

async function primeOpencodeParentThread(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.meta.update',
      commandId: asCommandId('cmd-opencode-thread-meta'),
      threadId: PARENT_THREAD_ID,
      modelSelection: {
        provider: 'opencode',
        model: 'anthropic/claude-sonnet-4-5',
        agentId: 'build',
      },
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: asCommandId('cmd-opencode-thread-session'),
      threadId: PARENT_THREAD_ID,
      session: {
        threadId: PARENT_THREAD_ID,
        status: 'running',
        providerName: 'opencode',
        providerSessionId: 'sess-root',
        providerThreadId: 'sess-root',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-root'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  harness.setProviderSession({
    provider: 'opencode',
    status: 'running',
    runtimeMode: 'approval-required',
    threadId: PARENT_THREAD_ID,
    providerSessionId: 'sess-root',
    providerThreadId: 'sess-root',
    createdAt: now,
    updatedAt: now,
  })
}

function createTempOpencodeAgentConfig(agentId: string, model: string): string {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orxa-opencode-agents-'))
  refs.tempDirs.push(configHome)
  const agentsDir = path.join(configHome, 'opencode', 'agents')
  fs.mkdirSync(agentsDir, { recursive: true })
  fs.writeFileSync(
    path.join(agentsDir, `${agentId}.md`),
    `---\nmode: subagent\nmodel: ${model}\n---\n\n# ${agentId}\n`
  )
  return configHome
}

function emitOpencodeTaskToolDelegation(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  emitOpencodeParentTaskToolStarted(harness, now)
  emitOpencodeChildSessionCreated(harness, now)
  emitOpencodeChildTextUpdate(harness, now)
}

function emitOpencodeParentTaskToolStarted(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'item.started',
    eventId: asEventId('evt-opencode-task-tool-started'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: OPENCODE_ROOT_TURN_ID,
    itemId: asRuntimeItemId('item-opencode-task-tool'),
    payload: {
      itemType: 'collab_agent_tool_call',
      status: 'inProgress',
      title: 'Subagent task',
      detail: OPENCODE_DELEGATED_DESCRIPTION,
      data: {
        item: {
          agent_label: 'explorer',
          prompt: OPENCODE_DELEGATED_PROMPT,
          description: OPENCODE_DELEGATED_DESCRIPTION,
        },
      },
    },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'message.part.updated',
      payload: {
        sessionID: 'sess-root',
        part: {
          id: 'part-task-tool-1',
          sessionID: 'sess-root',
          messageID: 'msg-parent-task-1',
          type: 'tool',
          tool: 'task',
          state: {
            status: 'running',
            input: {
              agent: 'explorer',
              prompt: OPENCODE_DELEGATED_PROMPT,
              description: OPENCODE_DELEGATED_DESCRIPTION,
            },
            time: { start: 1 },
          },
        },
        time: 1,
      },
    },
  } satisfies ProviderRuntimeEvent)
}

function emitOpencodeChildSessionCreated(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'session.started',
    eventId: asEventId('evt-opencode-task-child-created'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    payload: { message: 'opencode session sess-child-task-1 created' },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'session.created',
      payload: {
        sessionID: 'sess-child-task-1',
        info: {
          id: 'sess-child-task-1',
          slug: 'explorer-child',
          projectID: 'proj-1',
          directory: '/tmp/opencode-child',
          parentID: 'sess-root',
          title: 'Explorer task',
          version: '1.0.0',
          time: { created: 1, updated: 1 },
        },
      },
    },
  } satisfies ProviderRuntimeEvent)
}

function emitOpencodeChildTextUpdate(
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) {
  harness.emit({
    type: 'item.updated',
    eventId: asEventId('evt-opencode-task-child-text'),
    provider: 'opencode',
    createdAt: now,
    threadId: PARENT_THREAD_ID,
    turnId: opencodeChildTurnId('sess-child-task-1'),
    itemId: asRuntimeItemId('part-text-child-task-1'),
    payload: {
      itemType: 'assistant_message',
      status: 'inProgress',
      detail: 'Searching now.',
    },
    raw: {
      source: 'opencode.sdk.event',
      messageType: 'message.part.updated',
      payload: {
        sessionID: 'sess-child-task-1',
        part: {
          id: 'part-text-child-task-1',
          sessionID: 'sess-child-task-1',
          messageID: 'msg-child-task-1',
          type: 'text',
          text: 'Searching now.',
          time: { start: 2 },
        },
        time: 2,
      },
    },
  } satisfies ProviderRuntimeEvent)
}

it('resolves Opencode task-tool delegations to the delegated subagent config instead of the parent selection', async () => {
  const harness = await createHarness(refs)
  const now = new Date().toISOString()
  const childThreadId = asThreadId('opencode-child:thread-1:sess-child-task-1')
  process.env.XDG_CONFIG_HOME = createTempOpencodeAgentConfig(
    'explorer',
    'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo'
  )

  await primeOpencodeParentThread(harness, now)
  emitOpencodeTaskToolDelegation(harness, now)

  const childThread = await waitForThread(
    harness.engine,
    entry =>
      entry.id === childThreadId &&
      entry.title === 'Explorer' &&
      entry.messages.some(
        message => message.role === 'user' && message.text === OPENCODE_DELEGATED_PROMPT
      ) &&
      entry.modelSelection.provider === 'opencode' &&
      entry.modelSelection.agentId === 'explorer' &&
      entry.modelSelection.model === 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
    2000,
    childThreadId
  )

  expect(childThread.parentLink).toMatchObject({
    parentThreadId: 'thread-1',
    agentLabel: 'explorer',
    providerChildThreadId: 'sess-child-task-1',
  })
})
