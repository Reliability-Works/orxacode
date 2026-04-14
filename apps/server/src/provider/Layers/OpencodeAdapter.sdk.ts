/**
 * Typed wrapper around the opencode SDK v2 client.
 *
 * The adapter does not talk to `createOpencodeClient()` directly — every SDK
 * call goes through a thin helper in this module so the f04/f05 runtime code
 * can stay focused on Effect wiring and error shaping. Every helper returns a
 * native Promise and surfaces SDK `error` envelopes as thrown `Error`s so the
 * caller can wrap them in `Effect.tryPromise` uniformly. No Effect imports
 * here on purpose; the runtime half composes these helpers with
 * `acquireRelease`, `Effect.tryPromise`, and `Queue.offer`.
 *
 * @module OpencodeAdapter.sdk
 */
import type {
  Event as OpencodeEvent,
  Message as OpencodeMessage,
  OpencodeClient,
  Part as OpencodePart,
  Session as OpencodeSession,
} from '@opencode-ai/sdk/v2/client'

export interface SdkResponseLike<T> {
  readonly data?: T
  readonly error?: unknown
}

export interface CreateSessionInput {
  readonly client: OpencodeClient
  readonly directory?: string | undefined
  readonly title?: string | undefined
  readonly parentID?: string | undefined
}

export interface SendPromptInput {
  readonly client: OpencodeClient
  readonly sessionId: string
  readonly text: string
  readonly providerID: string
  readonly modelID: string
  readonly agent?: string | undefined
  readonly variant?: string | undefined
  readonly system?: string | undefined
  readonly messageID?: string | undefined
  readonly directory?: string | undefined
}

export interface AbortSessionInput {
  readonly client: OpencodeClient
  readonly sessionId: string
  readonly directory?: string | undefined
}

export interface ListProvidersInput {
  readonly client: OpencodeClient
  readonly directory?: string | undefined
}

export interface ListProvidersResult {
  readonly connected: ReadonlyArray<string>
}

export interface SubscribeEventsInput {
  readonly client: OpencodeClient
  readonly directory?: string | undefined
}

export interface GetMessageInput {
  readonly client: OpencodeClient
  readonly sessionId: string
  readonly messageId: string
  readonly directory?: string | undefined
}

export interface GetMessageResult {
  readonly info: OpencodeMessage
  readonly parts: ReadonlyArray<OpencodePart>
}

function unwrap<T>(response: SdkResponseLike<T>, method: string): T {
  if (response.error !== undefined && response.error !== null) {
    throw new Error(`opencode ${method} failed: ${formatSdkError(response.error)}`)
  }
  if (response.data === undefined) {
    throw new Error(`opencode ${method} returned no data`)
  }
  return response.data
}

function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export async function createOpencodeSession(input: CreateSessionInput): Promise<OpencodeSession> {
  const response = (await input.client.session.create({
    ...(input.directory ? { directory: input.directory } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.parentID ? { parentID: input.parentID } : {}),
  })) as SdkResponseLike<OpencodeSession>
  return unwrap(response, 'session.create')
}

export async function sendOpencodePrompt(input: SendPromptInput): Promise<void> {
  const response = (await input.client.session.promptAsync({
    sessionID: input.sessionId,
    ...(input.directory ? { directory: input.directory } : {}),
    model: { providerID: input.providerID, modelID: input.modelID },
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(input.messageID ? { messageID: input.messageID } : {}),
    parts: [{ type: 'text', text: input.text }],
  })) as unknown as SdkResponseLike<void>
  unwrap(response, 'session.promptAsync')
}

export interface ReplyPermissionInput {
  readonly client: OpencodeClient
  readonly requestID: string
  readonly reply: 'once' | 'always' | 'reject'
  readonly message?: string | undefined
  readonly directory?: string | undefined
}

export async function replyOpencodePermission(input: ReplyPermissionInput): Promise<void> {
  const response = (await input.client.permission.reply({
    requestID: input.requestID,
    reply: input.reply,
    ...(input.message ? { message: input.message } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<unknown>
  unwrap(response, 'permission.reply')
}

export interface ReplyQuestionInput {
  readonly client: OpencodeClient
  readonly requestID: string
  readonly answers: ReadonlyArray<ReadonlyArray<string>>
  readonly directory?: string | undefined
}

export async function replyOpencodeQuestion(input: ReplyQuestionInput): Promise<void> {
  const response = (await input.client.question.reply({
    requestID: input.requestID,
    answers: input.answers.map(answer => [...answer]),
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<unknown>
  unwrap(response, 'question.reply')
}

export interface RejectQuestionInput {
  readonly client: OpencodeClient
  readonly requestID: string
  readonly directory?: string | undefined
}

export async function rejectOpencodeQuestion(input: RejectQuestionInput): Promise<void> {
  const response = (await input.client.question.reject({
    requestID: input.requestID,
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<unknown>
  unwrap(response, 'question.reject')
}

export async function abortOpencodeSession(input: AbortSessionInput): Promise<boolean> {
  const response = (await input.client.session.abort({
    sessionID: input.sessionId,
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<boolean>
  const result = unwrap(response, 'session.abort')
  return result === true
}

export async function listOpencodeProviders(
  input: ListProvidersInput
): Promise<ListProvidersResult> {
  const response = (await input.client.provider.list({
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<{ connected?: ReadonlyArray<string> }>
  const data = unwrap(response, 'provider.list')
  return { connected: Array.isArray(data.connected) ? data.connected.slice() : [] }
}

export interface SubscribeEventsResult {
  readonly stream: AsyncIterable<OpencodeEvent>
}

export async function subscribeOpencodeEvents(
  input: SubscribeEventsInput
): Promise<SubscribeEventsResult> {
  const result = await input.client.event.subscribe({
    ...(input.directory ? { directory: input.directory } : {}),
  })
  return { stream: result.stream as AsyncIterable<OpencodeEvent> }
}

export async function getOpencodeMessage(input: GetMessageInput): Promise<GetMessageResult> {
  const response = (await input.client.session.message({
    sessionID: input.sessionId,
    messageID: input.messageId,
    ...(input.directory ? { directory: input.directory } : {}),
  })) as SdkResponseLike<GetMessageResult>
  return unwrap(response, 'session.message')
}
