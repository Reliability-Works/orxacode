/**
 * Canned opencode event sequences used by the pure mapper tests and the
 * streaming integration tests introduced in f05. Every fixture is a plain
 * object literal typed against the SDK's `Event` union so the compiler
 * enforces structural validity without any runtime schema decoding.
 *
 * @module OpencodeAdapter.streaming.fixtures
 */
import type {
  Event as OpencodeEvent,
  Message as OpencodeMessage,
  Part as OpencodePart,
  Session as OpencodeSession,
} from '@opencode-ai/sdk/v2/client'

export const FIXTURE_PROVIDER_SESSION_ID = 'sess_fixture_01'
export const FIXTURE_ASSISTANT_MESSAGE_ID = 'msg_assistant_01'
export const FIXTURE_TEXT_PART_ID = 'part_text_01'
export const FIXTURE_REASONING_PART_ID = 'part_reasoning_01'
export const FIXTURE_TOOL_PART_ID = 'part_tool_01'

export const fixtureSession: OpencodeSession = {
  id: FIXTURE_PROVIDER_SESSION_ID,
  slug: 'fixture',
  projectID: 'proj_fixture',
  directory: '/tmp/fixture',
  title: 'Fixture session',
  version: '1.0.0',
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

export const fixtureAssistantMessage: Extract<OpencodeMessage, { role: 'assistant' }> = {
  id: FIXTURE_ASSISTANT_MESSAGE_ID,
  sessionID: FIXTURE_PROVIDER_SESSION_ID,
  role: 'assistant',
  time: { created: 1_700_000_001_000 },
  parentID: 'msg_user_01',
  modelID: 'claude-sonnet-4-5',
  providerID: 'anthropic',
  mode: 'default',
  agent: 'default',
  path: { cwd: '/tmp/fixture', root: '/tmp/fixture' },
  cost: 0,
  tokens: {
    input: 10,
    output: 20,
    reasoning: 5,
    cache: { read: 0, write: 0 },
  },
}

export const fixtureAssistantMessageCompleted: Extract<OpencodeMessage, { role: 'assistant' }> = {
  ...fixtureAssistantMessage,
  time: { created: 1_700_000_001_000, completed: 1_700_000_002_000 },
  tokens: {
    input: 100,
    output: 200,
    reasoning: 50,
    cache: { read: 0, write: 0 },
    total: 350,
  },
}

export const fixtureTextPartInProgress: Extract<OpencodePart, { type: 'text' }> = {
  id: FIXTURE_TEXT_PART_ID,
  sessionID: FIXTURE_PROVIDER_SESSION_ID,
  messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
  type: 'text',
  text: 'Hello ',
  time: { start: 1_700_000_001_100 },
}

export const fixtureTextPartCompleted: Extract<OpencodePart, { type: 'text' }> = {
  ...fixtureTextPartInProgress,
  text: 'Hello world',
  time: { start: 1_700_000_001_100, end: 1_700_000_001_500 },
}

export const fixtureReasoningPartInProgress: Extract<OpencodePart, { type: 'reasoning' }> = {
  id: FIXTURE_REASONING_PART_ID,
  sessionID: FIXTURE_PROVIDER_SESSION_ID,
  messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
  type: 'reasoning',
  text: 'Let me think',
  time: { start: 1_700_000_001_050 },
}

export const fixtureToolPartRunning: Extract<OpencodePart, { type: 'tool' }> = {
  id: FIXTURE_TOOL_PART_ID,
  sessionID: FIXTURE_PROVIDER_SESSION_ID,
  messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
  type: 'tool',
  callID: 'call_01',
  tool: 'read',
  state: {
    status: 'running',
    input: { path: '/tmp/fixture/file.txt' },
    time: { start: 1_700_000_001_200 },
  },
}

export const fixtureToolPartCompleted: Extract<OpencodePart, { type: 'tool' }> = {
  ...fixtureToolPartRunning,
  state: {
    status: 'completed',
    input: { path: '/tmp/fixture/file.txt' },
    output: 'file contents',
    title: 'Read file',
    metadata: {},
    time: { start: 1_700_000_001_200, end: 1_700_000_001_400 },
  },
}

export const fixtureToolPartError: Extract<OpencodePart, { type: 'tool' }> = {
  ...fixtureToolPartRunning,
  state: {
    status: 'error',
    input: { path: '/tmp/fixture/missing.txt' },
    error: 'File not found',
    time: { start: 1_700_000_001_200, end: 1_700_000_001_350 },
  },
}

const PART_UPDATED_TIME = 1_700_000_001_500

type PartUpdatedEvent = Extract<OpencodeEvent, { type: 'message.part.updated' }>
type MessageUpdatedEvent = Extract<OpencodeEvent, { type: 'message.updated' }>

function partUpdated(part: OpencodePart): PartUpdatedEvent {
  return {
    type: 'message.part.updated',
    properties: {
      sessionID: FIXTURE_PROVIDER_SESSION_ID,
      part,
      time: PART_UPDATED_TIME,
    },
  }
}

function messageUpdated(info: OpencodeMessage): MessageUpdatedEvent {
  return {
    type: 'message.updated',
    properties: { sessionID: FIXTURE_PROVIDER_SESSION_ID, info },
  }
}

export const fixtureSessionCreated: Extract<OpencodeEvent, { type: 'session.created' }> = {
  type: 'session.created',
  properties: { sessionID: FIXTURE_PROVIDER_SESSION_ID, info: fixtureSession },
}

export const fixtureMessageUpdatedInProgress = messageUpdated(fixtureAssistantMessage)
export const fixtureMessageUpdatedCompleted = messageUpdated(fixtureAssistantMessageCompleted)
export const fixtureTextPartUpdatedInProgress = partUpdated(fixtureTextPartInProgress)
export const fixtureTextPartUpdatedCompleted = partUpdated(fixtureTextPartCompleted)
export const fixtureReasoningPartUpdated = partUpdated(fixtureReasoningPartInProgress)
export const fixtureToolPartUpdatedRunning = partUpdated(fixtureToolPartRunning)
export const fixtureToolPartUpdatedCompleted = partUpdated(fixtureToolPartCompleted)
export const fixtureToolPartUpdatedError = partUpdated(fixtureToolPartError)

export const fixtureTextPartDelta: Extract<OpencodeEvent, { type: 'message.part.delta' }> = {
  type: 'message.part.delta',
  properties: {
    sessionID: FIXTURE_PROVIDER_SESSION_ID,
    messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
    partID: FIXTURE_TEXT_PART_ID,
    field: 'text',
    delta: 'world',
  },
}

export const fixtureReasoningPartDelta: Extract<OpencodeEvent, { type: 'message.part.delta' }> = {
  type: 'message.part.delta',
  properties: {
    sessionID: FIXTURE_PROVIDER_SESSION_ID,
    messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
    partID: FIXTURE_REASONING_PART_ID,
    field: 'text',
    delta: ' harder',
  },
}

export const fixtureMessagePartRemoved: Extract<OpencodeEvent, { type: 'message.part.removed' }> = {
  type: 'message.part.removed',
  properties: {
    sessionID: FIXTURE_PROVIDER_SESSION_ID,
    messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
    partID: FIXTURE_TEXT_PART_ID,
  },
}

export const fixtureMessageRemoved: Extract<OpencodeEvent, { type: 'message.removed' }> = {
  type: 'message.removed',
  properties: {
    sessionID: FIXTURE_PROVIDER_SESSION_ID,
    messageID: FIXTURE_ASSISTANT_MESSAGE_ID,
  },
}

export const fixtureSessionIdle: Extract<OpencodeEvent, { type: 'session.idle' }> = {
  type: 'session.idle',
  properties: { sessionID: FIXTURE_PROVIDER_SESSION_ID },
}

export const fixtureSessionError: Extract<OpencodeEvent, { type: 'session.error' }> = {
  type: 'session.error',
  properties: {
    sessionID: FIXTURE_PROVIDER_SESSION_ID,
    error: {
      name: 'ProviderAuthError',
      data: {
        providerID: 'anthropic',
        message: 'Missing API key',
      },
    },
  },
}

export const streamingHappyPathFixtureSequence: ReadonlyArray<OpencodeEvent> = [
  fixtureSessionCreated,
  fixtureMessageUpdatedInProgress,
  fixtureTextPartUpdatedInProgress,
  fixtureTextPartDelta,
  fixtureTextPartUpdatedCompleted,
  fixtureMessageUpdatedCompleted,
  fixtureSessionIdle,
]
