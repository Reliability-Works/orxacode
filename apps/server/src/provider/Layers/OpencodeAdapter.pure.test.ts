/**
 * Unit coverage for the pure opencode event mapper.
 *
 * @module OpencodeAdapter.pure.test
 */
import { EventId, ThreadId, TurnId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import {
  isHandledOpencodeEvent,
  mapOpencodeEvent,
  type OpencodeEventStamp,
  type OpencodeMapperContext,
} from './OpencodeAdapter.pure.ts'
import {
  FIXTURE_PROVIDER_SESSION_ID,
  FIXTURE_REASONING_PART_ID,
  FIXTURE_TEXT_PART_ID,
  FIXTURE_TOOL_PART_ID,
  fixtureMessageRemoved,
  fixtureMessageUpdatedCompleted,
  fixtureMessageUpdatedInProgress,
  fixtureMessagePartRemoved,
  fixtureReasoningPartDelta,
  fixtureReasoningPartUpdated,
  fixtureSessionCreated,
  fixtureSessionError,
  fixtureSessionIdle,
  fixtureTextPartDelta,
  fixtureTextPartUpdatedCompleted,
  fixtureTextPartUpdatedInProgress,
  fixtureToolPartUpdatedCompleted,
  fixtureToolPartUpdatedError,
  fixtureToolPartUpdatedRunning,
} from './OpencodeAdapter.streaming.fixtures.ts'

const THREAD_ID = ThreadId.makeUnsafe('thread-opencode-fixture')
const TURN_ID = TurnId.makeUnsafe('turn-opencode-fixture')

function makeStamper(): () => OpencodeEventStamp {
  let counter = 0
  return () => {
    counter += 1
    const id = `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`
    return {
      eventId: EventId.makeUnsafe(id),
      createdAt: `2026-04-08T00:00:${counter.toString().padStart(2, '0')}.000Z`,
    }
  }
}

function makeCtx(overrides?: Partial<OpencodeMapperContext>): OpencodeMapperContext {
  return {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    providerSessionId: FIXTURE_PROVIDER_SESSION_ID,
    relatedSessionIds: new Set([FIXTURE_PROVIDER_SESSION_ID]),
    childDelegationsBySessionId: new Map(),
    nextStamp: makeStamper(),
    ...overrides,
  }
}

describe('mapOpencodeEvent session lifecycle', () => {
  it('maps session.created to session.started', () => {
    const result = mapOpencodeEvent(fixtureSessionCreated, makeCtx({ turnId: undefined }))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'session.started',
      provider: 'opencode',
      threadId: THREAD_ID,
      providerRefs: { providerItemId: FIXTURE_PROVIDER_SESSION_ID },
    })
  })

  it('drops session.created events for foreign sessions', () => {
    const ctx = makeCtx({
      providerSessionId: 'other-session',
      relatedSessionIds: new Set(['other-session']),
    })
    expect(mapOpencodeEvent(fixtureSessionCreated, ctx)).toEqual([])
  })

  it('maps session.idle to turn.completed when a turn is active', () => {
    const result = mapOpencodeEvent(fixtureSessionIdle, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'turn.completed',
      turnId: TURN_ID,
      payload: { state: 'completed' },
    })
  })

  it('ignores session.idle when no turn is active', () => {
    const result = mapOpencodeEvent(fixtureSessionIdle, makeCtx({ turnId: undefined }))
    expect(result).toEqual([])
  })
})

describe('mapOpencodeEvent message lifecycle', () => {
  it('emits item.started when an assistant message is in progress', () => {
    const result = mapOpencodeEvent(fixtureMessageUpdatedInProgress, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.started',
      payload: { itemType: 'assistant_message', status: 'inProgress' },
    })
  })

  it('emits token usage update when the assistant message completes', () => {
    const result = mapOpencodeEvent(fixtureMessageUpdatedCompleted, makeCtx())
    expect(result).toHaveLength(2)
    expect(result[0]?.type).toBe('item.started')
    expect(result[1]).toMatchObject({
      type: 'thread.token-usage.updated',
      payload: { usage: { usedTokens: 350 } },
    })
  })

  it('maps message.removed to a declined item update', () => {
    const result = mapOpencodeEvent(fixtureMessageRemoved, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.updated',
      payload: { itemType: 'assistant_message', status: 'declined' },
    })
  })
})

describe('mapOpencodeEvent text and reasoning parts', () => {
  it('emits item.updated while a text part is streaming', () => {
    const result = mapOpencodeEvent(fixtureTextPartUpdatedInProgress, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.updated',
      payload: { itemType: 'assistant_message', status: 'inProgress', detail: 'Hello ' },
    })
  })

  it('emits item.completed when a text part has end time', () => {
    const result = mapOpencodeEvent(fixtureTextPartUpdatedCompleted, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.completed',
      payload: { itemType: 'assistant_message', status: 'completed', detail: 'Hello world' },
    })
  })

  it('emits item.updated for reasoning parts in progress', () => {
    const result = mapOpencodeEvent(fixtureReasoningPartUpdated, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.updated',
      payload: { itemType: 'reasoning', status: 'inProgress' },
    })
  })

  it('maps text delta events to assistant_text content deltas', () => {
    const result = mapOpencodeEvent(fixtureTextPartDelta, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'content.delta',
      payload: { streamKind: 'assistant_text', delta: 'world' },
    })
  })

  it('maps reasoning delta events via part hint', () => {
    const result = mapOpencodeEvent(fixtureReasoningPartDelta, makeCtx(), {
      partId: FIXTURE_REASONING_PART_ID,
      partType: 'reasoning',
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'content.delta',
      payload: { streamKind: 'reasoning_text', delta: ' harder' },
    })
  })

  it('drops delta events for unknown fields', () => {
    const ctx = makeCtx()
    const result = mapOpencodeEvent(
      {
        type: 'message.part.delta',
        properties: {
          sessionID: FIXTURE_PROVIDER_SESSION_ID,
          messageID: 'm',
          partID: FIXTURE_TEXT_PART_ID,
          field: 'metadata',
          delta: '{}',
        },
      },
      ctx
    )
    expect(result).toEqual([])
  })

  it('marks removed parts as declined item updates', () => {
    const result = mapOpencodeEvent(fixtureMessagePartRemoved, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.updated',
      payload: { itemType: 'unknown', status: 'declined' },
    })
  })
})

describe('mapOpencodeEvent tool lifecycle', () => {
  it('emits item.started for a running tool call', () => {
    const result = mapOpencodeEvent(fixtureToolPartUpdatedRunning, makeCtx())
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      type: 'item.started',
      payload: { itemType: 'mcp_tool_call', status: 'inProgress', title: 'Read' },
      providerRefs: { providerItemId: FIXTURE_TOOL_PART_ID },
    })
    expect(result[1]).toMatchObject({
      type: 'item.updated',
      payload: { itemType: 'mcp_tool_call', status: 'inProgress', title: 'Read' },
      providerRefs: { providerItemId: FIXTURE_TOOL_PART_ID },
    })
  })

  it('emits item.completed for a completed tool call', () => {
    const result = mapOpencodeEvent(fixtureToolPartUpdatedCompleted, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.completed',
      payload: { itemType: 'mcp_tool_call', status: 'completed', title: 'Read' },
    })
  })

  it('emits failed item.completed with error detail for tool errors', () => {
    const result = mapOpencodeEvent(fixtureToolPartUpdatedError, makeCtx())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'item.completed',
      payload: {
        itemType: 'mcp_tool_call',
        status: 'failed',
        detail: 'File not found',
      },
    })
  })
})

describe('mapOpencodeEvent errors and abort', () => {
  it('emits runtime.error and turn.completed(failed) for session.error', () => {
    const result = mapOpencodeEvent(fixtureSessionError, makeCtx())
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      type: 'runtime.error',
      payload: { message: 'Missing API key', class: 'provider_error' },
    })
    expect(result[1]).toMatchObject({
      type: 'turn.completed',
      payload: { state: 'failed', errorMessage: 'Missing API key' },
    })
  })

  it('skips the turn.completed arm when no turn is active', () => {
    const result = mapOpencodeEvent(fixtureSessionError, makeCtx({ turnId: undefined }))
    expect(result).toHaveLength(1)
    expect(result[0]?.type).toBe('runtime.error')
  })
})

describe('isHandledOpencodeEvent', () => {
  it('recognises handled event types', () => {
    expect(isHandledOpencodeEvent(fixtureSessionCreated)).toBe(true)
    expect(isHandledOpencodeEvent(fixtureTextPartDelta)).toBe(true)
  })

  it('returns false for unhandled infrastructure events', () => {
    expect(
      isHandledOpencodeEvent({
        type: 'server.connected',
        properties: { url: 'http://127.0.0.1:1234' },
      })
    ).toBe(false)
  })
})
