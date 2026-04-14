import { type ProviderInteractionMode, type ProviderSession, TurnId } from '@orxa-code/contracts'

import { type CodexAccountSnapshot, resolveCodexModelForAccount } from './provider/codexAccount'

import {
  buildCodexCollaborationMode,
  mapCodexRuntimeMode,
  normalizeCodexModelSlug,
  readArrayField,
  readObjectField,
  readResumeThreadId,
  readStringField,
  type CodexTurnInputItem,
  type CodexTurnStartParams,
  type CodexTurnSteerParams,
} from './codexAppServerManager.protocol'

export interface CodexThreadTurnSnapshot {
  id: TurnId
  items: unknown[]
}

export interface CodexThreadSnapshot {
  threadId: string
  turns: CodexThreadTurnSnapshot[]
}

export interface BuildSessionOverridesInput {
  readonly serviceTier?: string
  readonly cwd?: string
  readonly runtimeMode?: import('@orxa-code/contracts').RuntimeMode
}

export function buildSessionOverrides(
  input: BuildSessionOverridesInput,
  normalizedModel: string | undefined
) {
  return {
    model: normalizedModel ?? null,
    ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
    cwd: input.cwd ?? null,
    ...mapCodexRuntimeMode(input.runtimeMode ?? 'full-access'),
  }
}

export interface BuildTurnInputInput {
  readonly input?: string
  readonly attachments?: ReadonlyArray<{ type: 'image'; url: string }>
}

export interface BuildTurnStartParamsInput extends BuildTurnInputInput {
  readonly model?: string
  readonly serviceTier?: string | null
  readonly effort?: string
  readonly interactionMode?: ProviderInteractionMode
}

export function requireProviderThreadId(session: ProviderSession): string {
  const providerThreadId = readResumeThreadId({
    threadId: session.threadId,
    runtimeMode: session.runtimeMode,
    resumeCursor: session.resumeCursor,
  })
  if (!providerThreadId) {
    throw new Error('Session is missing provider resume thread id.')
  }
  return providerThreadId
}

export function buildTurnStartParams(
  session: ProviderSession,
  account: CodexAccountSnapshot,
  input: BuildTurnStartParamsInput
): CodexTurnStartParams {
  const providerThreadId = requireProviderThreadId(session)
  const turnStartParams: CodexTurnStartParams = {
    threadId: providerThreadId,
    input: buildTurnInput(input),
  }
  const normalizedModel = resolveCodexModelForAccount(
    normalizeCodexModelSlug(input.model ?? session.model),
    account
  )

  if (normalizedModel) {
    turnStartParams.model = normalizedModel
  }
  if (input.serviceTier !== undefined) {
    turnStartParams.serviceTier = input.serviceTier
  }
  if (input.effort) {
    turnStartParams.effort = input.effort
  }

  const collaborationMode = buildCodexCollaborationMode({
    ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
  })
  if (collaborationMode) {
    if (!turnStartParams.model) {
      turnStartParams.model = collaborationMode.settings.model
    }
    turnStartParams.collaborationMode = collaborationMode
  }

  return turnStartParams
}

export function buildTurnSteerParams(
  session: ProviderSession,
  expectedTurnId: TurnId,
  input: BuildTurnInputInput
): CodexTurnSteerParams {
  const providerThreadId = requireProviderThreadId(session)
  return {
    threadId: providerThreadId,
    input: buildTurnInput(input),
    expectedTurnId,
  }
}

/**
 * An older Codex CLI that doesn't support `turn/steer` responds with JSON-RPC
 * error code -32601 ("method not found"). In that case we fall back to opening
 * a fresh `turn/start`, which is still better than dropping the queued message.
 */
export function isSteerMethodNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === -32601) return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  const lower = message.toLowerCase()
  return lower.includes('method not found')
}

export function buildTurnInput(input: BuildTurnInputInput): CodexTurnInputItem[] {
  const turnInput: CodexTurnInputItem[] = []

  if (input.input) {
    turnInput.push({
      type: 'text',
      text: input.input,
      text_elements: [],
    })
  }
  for (const attachment of input.attachments ?? []) {
    if (attachment.type === 'image') {
      turnInput.push({
        type: 'image',
        url: attachment.url,
      })
    }
  }
  if (turnInput.length === 0) {
    throw new Error('Turn input must include text or attachments.')
  }

  return turnInput
}

export function readStartedTurnId(response: unknown): TurnId {
  const turn = readObjectField(readObjectField(response), 'turn')
  const turnIdRaw = readStringField(turn, 'id')
  if (!turnIdRaw) {
    throw new Error('turn/start response did not include a turn id.')
  }
  return TurnId.makeUnsafe(turnIdRaw)
}

export function readThreadIdFromThreadOpenResponse(
  response: unknown,
  method: 'thread/start' | 'thread/resume'
): string {
  const threadOpenRecord = readObjectField(response)
  const threadIdRaw =
    readStringField(readObjectField(threadOpenRecord, 'thread'), 'id') ??
    readStringField(threadOpenRecord, 'threadId')
  if (!threadIdRaw) {
    throw new Error(`${method} response did not include a thread id.`)
  }
  return threadIdRaw
}

export function parseThreadSnapshot(method: string, response: unknown): CodexThreadSnapshot {
  const responseRecord = readObjectField(response)
  const thread = readObjectField(responseRecord, 'thread')
  const threadIdRaw = readStringField(thread, 'id') ?? readStringField(responseRecord, 'threadId')
  if (!threadIdRaw) {
    throw new Error(`${method} response did not include a thread id.`)
  }
  const turnsRaw = readArrayField(thread, 'turns') ?? readArrayField(responseRecord, 'turns') ?? []
  const turns = turnsRaw.map((turnValue, index) => {
    const turn = readObjectField(turnValue)
    const turnIdRaw = readStringField(turn, 'id') ?? `${threadIdRaw}:turn:${index + 1}`
    const turnId = TurnId.makeUnsafe(turnIdRaw)
    const items = readArrayField(turn, 'items') ?? []
    return {
      id: turnId,
      items,
    }
  })

  return {
    threadId: threadIdRaw,
    turns,
  }
}
