/**
 * Question-lifecycle mappers for the opencode adapter.
 *
 * Split out of `OpencodeAdapter.pure.ts` to keep that module under the 500-
 * line lint cap once the fatal-retry + interrupted-tool helpers landed.
 * Every handler here is a pure function of `(event, context)` — same shape
 * as the mappers that stayed in the parent module — so the dispatcher in
 * `OpencodeAdapter.pure.ts` can delegate without any ambient state.
 *
 * @module OpencodeAdapter.pure.questions
 */
import {
  type ProviderRuntimeEvent,
  RuntimeRequestId,
  type UserInputQuestion,
  type UserInputQuestionOption,
} from '@orxa-code/contracts'

import type { OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import type { OpencodeEvent } from './OpencodeAdapter.types.ts'
import {
  makeBaseForTurn,
  opencodeRawEvent,
  resolveMapperContext,
} from './OpencodeAdapter.shared.ts'

function toUserInputOption(
  option: Extract<
    OpencodeEvent,
    { type: 'question.asked' }
  >['properties']['questions'][number]['options'][number]
): UserInputQuestionOption {
  const label = option.label.trim()
  const description = option.description.trim()
  return {
    label: (label.length > 0 ? label : 'Option') as UserInputQuestionOption['label'],
    description: (description.length > 0
      ? description
      : label || 'Option') as UserInputQuestionOption['description'],
  }
}

function toUserInputQuestion(
  question: Extract<OpencodeEvent, { type: 'question.asked' }>['properties']['questions'][number],
  index: number
): UserInputQuestion {
  const header = question.header.trim()
  const prompt = question.question.trim()
  const id = `q${index}`
  return {
    id: id as UserInputQuestion['id'],
    header: (header.length > 0 ? header : `Question ${index + 1}`) as UserInputQuestion['header'],
    question: (prompt.length > 0
      ? prompt
      : header || `Question ${index + 1}`) as UserInputQuestion['question'],
    options: question.options.map(toUserInputOption),
    ...(question.multiple ? { multiSelect: true } : {}),
  }
}

export function mapQuestionAsked(
  event: Extract<OpencodeEvent, { type: 'question.asked' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  const questions = info.questions.map(toUserInputQuestion)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, info.tool?.callID),
      requestId: RuntimeRequestId.makeUnsafe(info.id),
      type: 'user-input.requested',
      payload: { questions },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapQuestionReplied(
  event: Extract<OpencodeEvent, { type: 'question.replied' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  // Downstream consumers only need the answers keyed somehow. Without the
  // original question ids the mapper can't key by question; the runtime
  // side (which has the pending map) could pass ids via partHint but we
  // keep the pure mapper ignorant and key by positional `q{index}`.
  const answers: Record<string, ReadonlyArray<string>> = {}
  info.answers.forEach((answer, index) => {
    answers[`q${index}`] = answer
  })
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      requestId: RuntimeRequestId.makeUnsafe(info.requestID),
      type: 'user-input.resolved',
      payload: { answers },
      raw: opencodeRawEvent(event),
    },
  ]
}

export function mapQuestionRejected(
  event: Extract<OpencodeEvent, { type: 'question.rejected' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const baseEvent = {
    ...makeBaseForTurn(ctx, resolved.turnId),
    requestId: RuntimeRequestId.makeUnsafe(info.requestID),
    raw: opencodeRawEvent(event),
  } as const
  return [{ ...baseEvent, type: 'user-input.resolved', payload: { answers: {} } }]
}
