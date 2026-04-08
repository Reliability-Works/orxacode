import type { PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ApprovalRequestId, ProviderItemId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect, Fiber, Random, Stream } from 'effect'

import { ClaudeAdapter } from '../Services/ClaudeAdapter.ts'
import {
  makeDeterministicRandomService,
  makeHarness,
  THREAD_ID,
} from './ClaudeAdapter.test.helpers.ts'

function buildAskUserQuestionInput(input: {
  question: string
  header: string
  options: ReadonlyArray<{ label: string; description: string }>
}) {
  return {
    questions: [
      {
        ...input,
        multiSelect: false,
      },
    ],
  }
}

function emitUserInputMessageStart(
  harness: ReturnType<typeof makeHarness>,
  input: Pick<Parameters<typeof startUserInputFlow>[0], 'messageId' | 'sessionId' | 'toolUseID'>
) {
  harness.query.emit({
    type: 'stream_event',
    session_id: input.sessionId,
    uuid: `stream-${input.toolUseID}`,
    parent_tool_use_id: null,
    event: {
      type: 'message_start',
      message: {
        id: input.messageId,
      },
    },
  } as unknown as SDKMessage)
}

function startUserInputFlow(input: {
  runtimeMode: 'approval-required' | 'full-access'
  turnInput?: string
  toolUseID: string
  messageId: string
  sessionId: string
  question: {
    question: string
    header: string
    options: ReadonlyArray<{ label: string; description: string }>
  }
}) {
  const harness = makeHarness()

  const effect = Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: input.runtimeMode,
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    if (input.turnInput) {
      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: input.turnInput,
        attachments: [],
      })
      yield* Stream.take(adapter.streamEvents, 1).pipe(Stream.runDrain)
    }

    emitUserInputMessageStart(harness, input)

    const threadStarted = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(threadStarted._tag, 'Some')
    if (threadStarted._tag !== 'Some' || threadStarted.value.type !== 'thread.started') {
      return
    }

    const createInput = harness.getLastCreateQueryInput()
    const canUseTool = createInput?.options.canUseTool
    assert.equal(typeof canUseTool, 'function')
    if (!canUseTool) {
      return
    }

    const askInput = buildAskUserQuestionInput(input.question)

    const permissionPromise = canUseTool('AskUserQuestion', askInput, {
      signal: new AbortController().signal,
      toolUseID: input.toolUseID,
    })

    const requestedEvent = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(requestedEvent._tag, 'Some')
    if (requestedEvent._tag !== 'Some') {
      return
    }
    assert.equal(requestedEvent.value.type, 'user-input.requested')
    if (requestedEvent.value.type !== 'user-input.requested') {
      return
    }

    const requestId = requestedEvent.value.requestId
    const requestedQuestions = requestedEvent.value.payload.questions
    const providerRefs = requestedEvent.value.providerRefs
    return {
      adapter,
      askInput,
      permissionPromise,
      providerRefs,
      requestId,
      requestedQuestions,
      session,
    } as const
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )

  return { effect, harness } as const
}

it.effect('handles AskUserQuestion via user-input.requested/resolved lifecycle', () => {
  const { effect, harness } = startUserInputFlow({
    runtimeMode: 'approval-required',
    turnInput: 'question turn',
    toolUseID: 'tool-ask-1',
    messageId: 'msg-user-input-thread',
    sessionId: 'sdk-session-user-input-1',
    question: {
      question: 'Which framework?',
      header: 'Framework',
      options: [
        { label: 'React', description: 'React.js' },
        { label: 'Vue', description: 'Vue.js' },
      ],
    },
  })

  return Effect.gen(function* () {
    const started = yield* effect
    if (!started) {
      return
    }

    const {
      adapter,
      askInput,
      permissionPromise,
      providerRefs,
      requestId,
      requestedQuestions,
      session,
    } = started
    assert.equal(typeof requestId, 'string')
    assert.equal(requestedQuestions.length, 1)
    assert.equal(requestedQuestions[0]?.question, 'Which framework?')
    assert.deepEqual(providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-ask-1'),
    })

    yield* adapter.respondToUserInput(session.threadId, ApprovalRequestId.makeUnsafe(requestId!), {
      'Which framework?': 'React',
    })

    const resolvedEvent = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(resolvedEvent._tag, 'Some')
    if (resolvedEvent._tag !== 'Some') {
      return
    }
    assert.equal(resolvedEvent.value.type, 'user-input.resolved')
    if (resolvedEvent.value.type !== 'user-input.resolved') {
      return
    }
    assert.deepEqual(resolvedEvent.value.payload.answers, {
      'Which framework?': 'React',
    })
    assert.deepEqual(resolvedEvent.value.providerRefs, {
      providerItemId: ProviderItemId.makeUnsafe('tool-ask-1'),
    })

    const permissionResult = yield* Effect.promise(() => permissionPromise)
    assert.equal((permissionResult as PermissionResult).behavior, 'allow')
    const updatedInput = (permissionResult as { updatedInput: Record<string, unknown> })
      .updatedInput
    assert.deepEqual(updatedInput.answers, { 'Which framework?': 'React' })
    assert.deepEqual(updatedInput.questions, askInput.questions)
  }).pipe(Effect.provide(harness.layer))
})

it.effect('routes AskUserQuestion through user-input flow even in full-access mode', () => {
  const { effect, harness } = startUserInputFlow({
    runtimeMode: 'full-access',
    toolUseID: 'tool-ask-2',
    messageId: 'msg-user-input-full-access',
    sessionId: 'sdk-session-user-input-2',
    question: {
      question: 'Deploy to which env?',
      header: 'Env',
      options: [
        { label: 'Staging', description: 'Staging environment' },
        { label: 'Production', description: 'Production environment' },
      ],
    },
  })

  return Effect.gen(function* () {
    const started = yield* effect
    if (!started) {
      return
    }

    const { adapter, permissionPromise, requestId, session } = started
    yield* adapter.respondToUserInput(session.threadId, ApprovalRequestId.makeUnsafe(requestId!), {
      'Deploy to which env?': 'Staging',
    })
    yield* Stream.runHead(adapter.streamEvents)

    const permissionResult = yield* Effect.promise(() => permissionPromise)
    assert.equal((permissionResult as PermissionResult).behavior, 'allow')
    const updatedInput = (permissionResult as { updatedInput: Record<string, unknown> })
      .updatedInput
    assert.deepEqual(updatedInput.answers, { 'Deploy to which env?': 'Staging' })
  }).pipe(Effect.provide(harness.layer))
})

function makeNativeObservabilityHarness() {
  const nativeEvents: Array<{
    event?: {
      provider?: string
      method?: string
      threadId?: string
      turnId?: string
    }
  }> = []
  const nativeThreadIds: Array<string | null> = []
  const harness = makeHarness({
    nativeEventLogger: {
      filePath: 'memory://claude-native-events',
      write: (event, threadId) => {
        nativeEvents.push(event as (typeof nativeEvents)[number])
        nativeThreadIds.push(threadId ?? null)
        return Effect.void
      },
      close: () => Effect.void,
    },
  })
  return { harness, nativeEvents, nativeThreadIds } as const
}

it.effect('denies AskUserQuestion when the waiting turn is aborted', () => {
  const harness = makeHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'approval-required',
    })

    yield* Stream.take(adapter.streamEvents, 3).pipe(Stream.runDrain)

    const createInput = harness.getLastCreateQueryInput()
    const canUseTool = createInput?.options.canUseTool
    assert.equal(typeof canUseTool, 'function')
    if (!canUseTool) {
      return
    }

    const controller = new AbortController()
    const permissionPromise = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Continue?',
            header: 'Continue',
            options: [{ label: 'Yes', description: 'Proceed' }],
            multiSelect: false,
          },
        ],
      },
      {
        signal: controller.signal,
        toolUseID: 'tool-ask-abort',
      }
    )

    const requestedEvent = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(requestedEvent._tag, 'Some')
    if (requestedEvent._tag !== 'Some' || requestedEvent.value.type !== 'user-input.requested') {
      assert.fail('Expected user-input.requested event')
      return
    }
    assert.equal(requestedEvent.value.threadId, session.threadId)

    controller.abort()

    const resolvedEvent = yield* Stream.runHead(adapter.streamEvents)
    assert.equal(resolvedEvent._tag, 'Some')
    if (resolvedEvent._tag !== 'Some' || resolvedEvent.value.type !== 'user-input.resolved') {
      assert.fail('Expected user-input.resolved event')
      return
    }
    assert.deepEqual(resolvedEvent.value.payload.answers, {})

    const permissionResult = yield* Effect.promise(() => permissionPromise)
    assert.deepEqual(permissionResult, {
      behavior: 'deny',
      message: 'User cancelled tool execution.',
    } satisfies PermissionResult)
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})

it.effect('writes provider-native observability records when enabled', () => {
  const { harness, nativeEvents, nativeThreadIds } = makeNativeObservabilityHarness()
  return Effect.gen(function* () {
    const adapter = yield* ClaudeAdapter

    const session = yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: 'claudeAgent',
      runtimeMode: 'full-access',
    })
    const turn = yield* adapter.sendTurn({
      threadId: session.threadId,
      input: 'hello',
      attachments: [],
    })

    const turnCompletedFiber = yield* Stream.filter(
      adapter.streamEvents,
      event => event.type === 'turn.completed'
    ).pipe(Stream.runHead, Effect.forkChild)

    harness.query.emit({
      type: 'stream_event',
      session_id: 'sdk-session-native-log',
      uuid: 'stream-native-log',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'hi',
        },
      },
    } as unknown as SDKMessage)

    harness.query.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-native-log',
      uuid: 'result-native-log',
    } as unknown as SDKMessage)

    const turnCompleted = yield* Fiber.join(turnCompletedFiber)
    assert.equal(turnCompleted._tag, 'Some')

    assert.equal(nativeEvents.length > 0, true)
    assert.equal(
      nativeEvents.some(record => record.event?.provider === 'claudeAgent'),
      true
    )
    assert.equal(
      nativeEvents.some(
        record =>
          String(
            (record.event as { readonly providerThreadId?: string } | undefined)?.providerThreadId
          ) === 'sdk-session-native-log'
      ),
      true
    )
    assert.equal(
      nativeEvents.some(record => String(record.event?.turnId) === String(turn.turnId)),
      true
    )
    assert.equal(
      nativeEvents.some(
        record => record.event?.method === 'claude/stream_event/content_block_delta/text_delta'
      ),
      true
    )
    assert.equal(
      nativeThreadIds.every(threadId => threadId === String(THREAD_ID)),
      true
    )
  }).pipe(
    Effect.provideService(Random.Random, makeDeterministicRandomService()),
    Effect.provide(harness.layer)
  )
})
