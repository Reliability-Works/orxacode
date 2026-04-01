import type { SessionMessageBundle } from '@shared/ipc'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { SessionCompactionState, TurnTokenSample } from './session-controls'

const MIN_COMPACTION_THRESHOLD = 24_000
const DEFAULT_COMPACTION_THRESHOLD = 120_000

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function tokenCountFromMessageInfo(info: SessionMessageBundle['info']) {
  if (info.role !== 'assistant') {
    return 0
  }
  const assistantInfo = info as SessionMessageBundle['info'] & {
    tokens?: {
      total?: number
      input?: number
      output?: number
      cache?: { read?: number; write?: number }
    }
  }
  const total = typeof assistantInfo.tokens?.total === 'number' ? assistantInfo.tokens.total : 0
  if (total > 0) {
    return total
  }
  const input = typeof assistantInfo.tokens?.input === 'number' ? assistantInfo.tokens.input : 0
  const output = typeof assistantInfo.tokens?.output === 'number' ? assistantInfo.tokens.output : 0
  const cacheRead =
    typeof assistantInfo.tokens?.cache?.read === 'number' ? assistantInfo.tokens.cache.read : 0
  const cacheWrite =
    typeof assistantInfo.tokens?.cache?.write === 'number' ? assistantInfo.tokens.cache.write : 0
  return input + output + cacheRead + cacheWrite
}

function getMessageTimestamp(bundle: SessionMessageBundle) {
  const timeRecord = bundle.info.time as Record<string, unknown> & { created: number }
  return typeof timeRecord.updated === 'number' ? timeRecord.updated : timeRecord.created
}

export function getOpencodeObservedTokenTotal(messages: SessionMessageBundle[]) {
  return messages.reduce((sum, bundle) => sum + tokenCountFromMessageInfo(bundle.info), 0)
}

export function buildOpencodeCompactionState(
  messages: SessionMessageBundle[]
): SessionCompactionState {
  const compactionIndexes: number[] = []
  const compactionThresholdHints: number[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const bundle = messages[index]
    if (!bundle.parts.some(part => part.type === 'compaction')) {
      continue
    }
    compactionIndexes.push(index)
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const previousTokens = tokenCountFromMessageInfo(messages[previous]!.info)
      if (previousTokens > 0) {
        compactionThresholdHints.push(previousTokens)
        break
      }
    }
  }

  const lastCompactionIndex =
    compactionIndexes.length > 0 ? compactionIndexes[compactionIndexes.length - 1]! : -1
  let currentTokens = 0
  for (let index = messages.length - 1; index > lastCompactionIndex; index -= 1) {
    const tokens = tokenCountFromMessageInfo(messages[index]!.info)
    if (tokens > 0) {
      currentTokens = tokens
      break
    }
  }

  let threshold =
    compactionThresholdHints.length > 0
      ? compactionThresholdHints[compactionThresholdHints.length - 1]!
      : DEFAULT_COMPACTION_THRESHOLD
  threshold = Math.max(MIN_COMPACTION_THRESHOLD, threshold)
  if (currentTokens > threshold) {
    threshold = currentTokens
  }

  const progress = threshold > 0 ? clamp01(currentTokens / threshold) : 0
  const compacted =
    lastCompactionIndex >= 0 && currentTokens < Math.max(4_000, Math.round(threshold * 0.22))

  return {
    progress,
    compacted,
    estimated: false,
    lastCompactedAt:
      lastCompactionIndex >= 0 ? getMessageTimestamp(messages[lastCompactionIndex]!) : undefined,
    hint: compacted
      ? 'Recent context compaction completed. The context window has been reset.'
      : `Estimated context usage before auto-compaction (${currentTokens.toLocaleString()} / ${threshold.toLocaleString()} tokens).`,
  }
}

function buildTurnUsageCompactionState(input: {
  turnTokenTotals: TurnTokenSample[]
  compactionTimestamps?: number[]
  estimated: boolean
  providerLabel: string
}) {
  const turnSamples = input.turnTokenTotals.filter(sample => sample.total > 0)
  if (turnSamples.length === 0) {
    return {
      progress: 0,
      compacted: false,
      estimated: input.estimated,
      hint: input.estimated
        ? `${input.providerLabel} context usage is estimated from observed turns.`
        : `${input.providerLabel} context usage is not available yet.`,
    } satisfies SessionCompactionState
  }

  const lastSample = turnSamples[turnSamples.length - 1]!
  const previousSamples = turnSamples.slice(0, -1)
  const priorHighWater = previousSamples.reduce(
    (max, sample) => Math.max(max, sample.total),
    0
  )
  const lastCompactionAt = input.compactionTimestamps?.length
    ? input.compactionTimestamps[input.compactionTimestamps.length - 1]
    : undefined
  const compactionThresholdHint =
    typeof lastCompactionAt === 'number'
      ? turnSamples
          .filter(sample => sample.timestamp <= lastCompactionAt)
          .reduce((max, sample) => Math.max(max, sample.total), 0)
      : 0
  const threshold = Math.max(
    MIN_COMPACTION_THRESHOLD,
    compactionThresholdHint || priorHighWater || DEFAULT_COMPACTION_THRESHOLD,
    lastSample.total
  )
  const compacted =
    (typeof lastCompactionAt === 'number' || priorHighWater >= MIN_COMPACTION_THRESHOLD) &&
    lastSample.total <
      Math.max(4_000, Math.round(Math.max(compactionThresholdHint, priorHighWater, threshold) * 0.22))

  return {
    progress: clamp01(lastSample.total / threshold),
    compacted,
    estimated: input.estimated,
    lastCompactedAt:
      compacted && typeof lastCompactionAt === 'number' ? lastCompactionAt : undefined,
    hint: compacted
      ? `${
          input.estimated ? 'Estimated recent' : 'Recent'
        } context compaction completed. The context window has been reset.`
      : `${
          input.estimated ? 'Estimated' : 'Observed'
        } context usage before compaction (${lastSample.total.toLocaleString()} / ${threshold.toLocaleString()} tokens).`,
  } satisfies SessionCompactionState
}

export function buildCodexCompactionState(
  messages: CodexMessageItem[],
  turnTokenTotals: TurnTokenSample[]
) {
  const compactionTimestamps = messages
    .filter(
      (item): item is Extract<CodexMessageItem, { kind: 'compaction' }> => item.kind === 'compaction'
    )
    .map(item => item.timestamp)
  return buildTurnUsageCompactionState({
    turnTokenTotals,
    compactionTimestamps,
    estimated: false,
    providerLabel: 'Codex',
  })
}

export function buildClaudeCompactionState(turnTokenTotals: TurnTokenSample[]) {
  return buildTurnUsageCompactionState({
    turnTokenTotals,
    estimated: true,
    providerLabel: 'Claude',
  })
}
