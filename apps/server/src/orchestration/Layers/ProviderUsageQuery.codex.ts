/**
 * Codex JSONL session-log scanner for {@link ProviderUsageQueryLive}.
 *
 * Codex's logs are organized as `~/.codex/sessions/YYYY/MM/DD/*.jsonl`. Every
 * session file contains interleaved `turn_context` events (which carry the
 * current model) and `event_msg` envelopes with `payload.type === 'token_count'`.
 * Token counts are reported as running totals, so consecutive events are
 * subtracted to obtain per-turn deltas.
 *
 * @module ProviderUsageQuery.codex
 */
import type { ModelUsage, ProviderUsageSnapshot } from '@orxa-code/contracts'

import {
  asRecord,
  findJsonlFiles,
  listJsonlFilesInDayRoots,
  makeDayKeys,
  parseJsonLine,
  readNumberFromMap,
  readTimestampMs,
  resolveCodexSessionsRoot,
  safeReadFile,
} from './ProviderUsageQuery.fs.ts'
import { dollarsToCents, estimateCostDollars } from './ProviderUsageQuery.pricing.ts'

const TOP_MODELS_LIMIT = 6
const UNKNOWN_MODEL = 'unknown'

interface UsageTotals {
  readonly input: number
  readonly cached: number
  readonly output: number
}

interface CodexModelUsage {
  input: number
  cached: number
  output: number
}

interface CodexAggregate {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  modelUsage: Map<string, CodexModelUsage>
  modelSessionCounts: Map<string, number>
  updatedAt: number
}

function emptyCodexAggregate(): CodexAggregate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    modelUsage: new Map(),
    modelSessionCounts: new Map(),
    updatedAt: 0,
  }
}

function extractModelFromTurnContext(value: Record<string, unknown>): string | null {
  const payload = asRecord(value['payload'])
  if (!payload) {
    return null
  }
  const payloadModel = payload['model']
  if (typeof payloadModel === 'string' && payloadModel.trim().length > 0) {
    return payloadModel
  }
  const info = asRecord(payload['info'])
  if (info && typeof info['model'] === 'string' && (info['model'] as string).trim().length > 0) {
    return info['model'] as string
  }
  return null
}

function extractModelFromTokenCount(payload: Record<string, unknown>): string | null {
  const info = asRecord(payload['info'])
  const candidate = info?.['model'] ?? info?.['model_name'] ?? payload['model']
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null
}

interface TokenDelta {
  readonly delta: UsageTotals
  readonly nextTotals: UsageTotals | null
}

function deltaFromTotal(
  totalTokenUsage: Record<string, unknown>,
  previousTotals: UsageTotals | null
): TokenDelta {
  const input = readNumberFromMap(totalTokenUsage, ['input_tokens', 'inputTokens'])
  const cached = readNumberFromMap(totalTokenUsage, [
    'cached_input_tokens',
    'cache_read_input_tokens',
    'cachedInputTokens',
    'cacheReadInputTokens',
  ])
  const output = readNumberFromMap(totalTokenUsage, ['output_tokens', 'outputTokens'])
  const previous = previousTotals ?? { input: 0, cached: 0, output: 0 }
  return {
    delta: {
      input: Math.max(0, input - previous.input),
      cached: Math.max(0, cached - previous.cached),
      output: Math.max(0, output - previous.output),
    },
    nextTotals: { input, cached, output },
  }
}

function deltaFromLast(
  lastTokenUsage: Record<string, unknown>,
  previousTotals: UsageTotals | null
): TokenDelta {
  const delta: UsageTotals = {
    input: readNumberFromMap(lastTokenUsage, ['input_tokens', 'inputTokens']),
    cached: readNumberFromMap(lastTokenUsage, [
      'cached_input_tokens',
      'cache_read_input_tokens',
      'cachedInputTokens',
      'cacheReadInputTokens',
    ]),
    output: readNumberFromMap(lastTokenUsage, ['output_tokens', 'outputTokens']),
  }
  const previous = previousTotals ?? { input: 0, cached: 0, output: 0 }
  return {
    delta,
    nextTotals: {
      input: previous.input + delta.input,
      cached: previous.cached + delta.cached,
      output: previous.output + delta.output,
    },
  }
}

function extractTokenDelta(
  info: Record<string, unknown> | null,
  previousTotals: UsageTotals | null
): TokenDelta | null {
  if (!info) {
    return null
  }
  const totalTokenUsage = asRecord(info['total_token_usage'] ?? info['totalTokenUsage'])
  if (totalTokenUsage) {
    return deltaFromTotal(totalTokenUsage, previousTotals)
  }
  const lastTokenUsage = asRecord(info['last_token_usage'] ?? info['lastTokenUsage'])
  if (lastTokenUsage) {
    return deltaFromLast(lastTokenUsage, previousTotals)
  }
  return null
}

interface ConsumeState {
  previousTotals: UsageTotals | null
  currentModel: string | null
}

function addModelDelta(
  aggregate: CodexAggregate,
  model: string,
  delta: UsageTotals,
  cached: number
): void {
  const existing = aggregate.modelUsage.get(model) ?? { input: 0, cached: 0, output: 0 }
  aggregate.modelUsage.set(model, {
    input: existing.input + delta.input,
    cached: existing.cached + cached,
    output: existing.output + delta.output,
  })
}

function consumeTokenCount(
  aggregate: CodexAggregate,
  payload: Record<string, unknown>,
  state: ConsumeState,
  modelsSeenInSession: Set<string>
): ConsumeState {
  const next = extractTokenDelta(asRecord(payload['info']), state.previousTotals)
  if (!next) {
    return state
  }
  const cached = Math.min(next.delta.cached, next.delta.input)
  if (next.delta.input === 0 && cached === 0 && next.delta.output === 0) {
    return { previousTotals: next.nextTotals, currentModel: state.currentModel }
  }

  aggregate.inputTokens += next.delta.input
  aggregate.cacheReadTokens += cached
  aggregate.outputTokens += next.delta.output

  const model = state.currentModel ?? extractModelFromTokenCount(payload) ?? UNKNOWN_MODEL
  addModelDelta(aggregate, model, next.delta, cached)
  modelsSeenInSession.add(model)
  return { previousTotals: next.nextTotals, currentModel: model }
}

function processLine(
  aggregate: CodexAggregate,
  parsed: Record<string, unknown>,
  state: ConsumeState,
  modelsSeenInSession: Set<string>
): ConsumeState {
  const timestampMs = readTimestampMs(parsed)
  if (timestampMs) {
    aggregate.updatedAt = Math.max(aggregate.updatedAt, timestampMs)
  }
  if (parsed['type'] === 'turn_context') {
    return {
      previousTotals: state.previousTotals,
      currentModel: extractModelFromTurnContext(parsed) ?? state.currentModel,
    }
  }
  if (parsed['type'] !== 'event_msg' && parsed['type'] !== '') {
    return state
  }
  const payload = asRecord(parsed['payload'])
  if (!payload || payload['type'] !== 'token_count') {
    return state
  }
  return consumeTokenCount(aggregate, payload, state, modelsSeenInSession)
}

async function scanSessionFile(aggregate: CodexAggregate, filePath: string): Promise<void> {
  const content = await safeReadFile(filePath)
  if (content === null) {
    return
  }
  let state: ConsumeState = { previousTotals: null, currentModel: null }
  const modelsSeenInSession = new Set<string>()
  for (const line of content.split('\n')) {
    const parsed = parseJsonLine<Record<string, unknown>>(line)
    if (parsed) {
      state = processLine(aggregate, parsed, state, modelsSeenInSession)
    }
  }
  for (const model of modelsSeenInSession) {
    aggregate.modelSessionCounts.set(model, (aggregate.modelSessionCounts.get(model) ?? 0) + 1)
  }
}

function buildTopModels(aggregate: CodexAggregate): ReadonlyArray<ModelUsage> {
  const entries: Array<ModelUsage> = []
  for (const [model, count] of aggregate.modelSessionCounts.entries()) {
    if (model === UNKNOWN_MODEL) {
      continue
    }
    const usage = aggregate.modelUsage.get(model) ?? { input: 0, cached: 0, output: 0 }
    entries.push({
      model,
      provider: 'codex',
      count,
      tokensIn: usage.input,
      tokensOut: usage.output,
      costCents: dollarsToCents(
        estimateCostDollars(model, usage.input, usage.cached, usage.output)
      ),
    })
  }
  entries.sort((left, right) => right.count - left.count)
  return entries.slice(0, TOP_MODELS_LIMIT)
}

function totalCostDollars(aggregate: CodexAggregate): number {
  let total = 0
  for (const [model, usage] of aggregate.modelUsage.entries()) {
    total += estimateCostDollars(model, usage.input, usage.cached, usage.output)
  }
  return total
}

export async function readCodexUsage(): Promise<ProviderUsageSnapshot> {
  const sessionsRoot = resolveCodexSessionsRoot()
  const [totalThreadFiles, dayKeys30] = await Promise.all([
    findJsonlFiles(sessionsRoot),
    Promise.resolve(makeDayKeys(30)),
  ])
  const dayKeys7 = dayKeys30.slice(-7)
  const files30 = await listJsonlFilesInDayRoots(sessionsRoot, dayKeys30)
  const files7 = await listJsonlFilesInDayRoots(sessionsRoot, dayKeys7)

  const aggregate = emptyCodexAggregate()
  for (const filePath of files30) {
    await scanSessionFile(aggregate, filePath)
  }

  const topModels = buildTopModels(aggregate)
  const knownModelCount = [...aggregate.modelSessionCounts.keys()].filter(
    model => model !== UNKNOWN_MODEL
  ).length
  const updatedAtMs = aggregate.updatedAt > 0 ? aggregate.updatedAt : Date.now()

  return {
    provider: 'codex',
    updatedAt: new Date(updatedAtMs).toISOString(),
    totalSessions: totalThreadFiles.length,
    sessions7d: files7.length,
    sessions30d: files30.length,
    modelCount: knownModelCount,
    tokensIn: aggregate.inputTokens,
    tokensOut: aggregate.outputTokens,
    tokensCacheRead: aggregate.cacheReadTokens,
    estimatedCostCents: dollarsToCents(totalCostDollars(aggregate)),
    topModels,
  }
}
