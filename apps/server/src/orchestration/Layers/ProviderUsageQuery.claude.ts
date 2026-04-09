/**
 * Claude Code JSONL session-log scanner for {@link ProviderUsageQueryLive}.
 *
 * Claude's `~/.claude/projects/**` log files are line-delimited JSON. Each
 * assistant response carries a `message.usage` block with `input_tokens`,
 * `output_tokens`, and `cache_read_input_tokens`. Per-model totals are
 * aggregated so every row in the top-models list has real token counts and
 * a cost estimate.
 *
 * @module ProviderUsageQuery.claude
 */
import type { ModelUsage, ProviderUsageSnapshot } from '@orxa-code/contracts'

import {
  findJsonlFiles,
  parseJsonLine,
  resolveClaudeProjectsRoot,
  safeReadFile,
  safeStatMtimeMs,
} from './ProviderUsageQuery.fs.ts'
import { dollarsToCents, estimateCostDollars } from './ProviderUsageQuery.pricing.ts'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const TOP_MODELS_LIMIT = 6

interface ClaudeJsonlLine {
  readonly type?: string
  readonly message?: {
    readonly usage?: {
      readonly input_tokens?: number
      readonly output_tokens?: number
      readonly cache_creation_input_tokens?: number
      readonly cache_read_input_tokens?: number
    }
    readonly model?: string
  }
}

interface ClaudeModelTotals {
  count: number
  input: number
  output: number
  cacheRead: number
}

interface ClaudeAggregate {
  totalFiles: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  sessions7d: number
  sessions30d: number
  modelTotals: Map<string, ClaudeModelTotals>
}

function emptyAggregate(): ClaudeAggregate {
  return {
    totalFiles: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    sessions7d: 0,
    sessions30d: 0,
    modelTotals: new Map(),
  }
}

async function countSessionWindows(
  aggregate: ClaudeAggregate,
  filePath: string,
  now: number
): Promise<void> {
  const modifiedAt = await safeStatMtimeMs(filePath)
  if (modifiedAt === null) {
    return
  }
  if (modifiedAt >= now - THIRTY_DAYS_MS) {
    aggregate.sessions30d += 1
  }
  if (modifiedAt >= now - SEVEN_DAYS_MS) {
    aggregate.sessions7d += 1
  }
}

function recordModelUsage(
  aggregate: ClaudeAggregate,
  model: string,
  input: number,
  output: number,
  cacheRead: number
): void {
  const existing = aggregate.modelTotals.get(model) ?? {
    count: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
  }
  aggregate.modelTotals.set(model, {
    count: existing.count + 1,
    input: existing.input + input,
    output: existing.output + output,
    cacheRead: existing.cacheRead + cacheRead,
  })
}

function consumeAssistantLine(aggregate: ClaudeAggregate, parsed: ClaudeJsonlLine): void {
  if (parsed.type !== 'assistant' || !parsed.message?.usage) {
    return
  }
  const usage = parsed.message.usage
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  aggregate.inputTokens += input
  aggregate.outputTokens += output
  aggregate.cacheReadTokens += cacheRead
  const model = parsed.message.model
  if (model && model.length > 0) {
    recordModelUsage(aggregate, model, input, output, cacheRead)
  }
}

async function scanFile(aggregate: ClaudeAggregate, filePath: string): Promise<void> {
  const content = await safeReadFile(filePath)
  if (content === null) {
    return
  }
  for (const line of content.split('\n')) {
    const parsed = parseJsonLine<ClaudeJsonlLine>(line)
    if (parsed) {
      consumeAssistantLine(aggregate, parsed)
    }
  }
}

function buildTopModels(aggregate: ClaudeAggregate): ReadonlyArray<ModelUsage> {
  const entries: Array<ModelUsage> = []
  for (const [model, totals] of aggregate.modelTotals.entries()) {
    entries.push({
      model,
      provider: 'claudeAgent',
      count: totals.count,
      tokensIn: totals.input,
      tokensOut: totals.output,
      costCents: dollarsToCents(
        estimateCostDollars(model, totals.input, totals.cacheRead, totals.output)
      ),
    })
  }
  entries.sort((left, right) => right.count - left.count)
  return entries.slice(0, TOP_MODELS_LIMIT)
}

export async function readClaudeUsage(): Promise<ProviderUsageSnapshot> {
  const aggregate = emptyAggregate()
  const jsonlFiles = await findJsonlFiles(resolveClaudeProjectsRoot())
  aggregate.totalFiles = jsonlFiles.length
  const now = Date.now()

  for (const filePath of jsonlFiles) {
    await countSessionWindows(aggregate, filePath, now)
    await scanFile(aggregate, filePath)
  }

  const topModels = buildTopModels(aggregate)
  const totalCostDollars = topModels.reduce((sum, entry) => sum + entry.costCents / 100, 0)

  return {
    provider: 'claudeAgent',
    updatedAt: new Date(now).toISOString(),
    totalSessions: aggregate.sessions30d,
    sessions7d: aggregate.sessions7d,
    sessions30d: aggregate.sessions30d,
    modelCount: aggregate.modelTotals.size,
    tokensIn: aggregate.inputTokens,
    tokensOut: aggregate.outputTokens,
    tokensCacheRead: aggregate.cacheReadTokens,
    estimatedCostCents: dollarsToCents(totalCostDollars),
    topModels,
  }
}
