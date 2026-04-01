import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export interface ProviderUsageStats {
  totalThreads: number
  sessions7d: number
  sessions30d: number
  totalSessions: number
  modelCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalCost: number
  topModels: Array<{ model: string; count: number }>
  updatedAt: number
}

const MODEL_PRICING: Record<string, { input: number; cachedInput?: number; output: number }> = {
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
  opus: { input: 15, output: 75 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  o1: { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'codex-mini': { input: 1.5, cachedInput: 0.375, output: 6 },
}

type UsageTotals = {
  input: number
  cached: number
  output: number
}

type CodexUsageAggregate = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  modelUsage: Map<string, { input: number; cached: number; output: number }>
  modelSessionCounts: Map<string, number>
  updatedAt: number
}

interface ClaudeJsonlLine {
  type?: string
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    model?: string
  }
}

function estimateCost(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number {
  const lower = model.toLowerCase()
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) {
      const cached = Math.min(cachedInputTokens, inputTokens)
      const uncached = Math.max(0, inputTokens - cached)
      return (
        (uncached / 1_000_000) * pricing.input +
        (cached / 1_000_000) * (pricing.cachedInput ?? pricing.input) +
        (outputTokens / 1_000_000) * pricing.output
      )
    }
  }
  const cached = Math.min(cachedInputTokens, inputTokens)
  const uncached = Math.max(0, inputTokens - cached)
  return (uncached / 1_000_000) * 3 + (cached / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 15
}

async function findJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await findJsonlFiles(fullPath)))
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory missing or unreadable.
  }
  return results
}

function resolveHomeDir() {
  return process.env.HOME ?? ''
}

function resolveCodexSessionsRoot() {
  const codexHome = process.env.CODEX_HOME?.trim()
  if (codexHome) {
    return path.join(codexHome, 'sessions')
  }
  return path.join(resolveHomeDir(), '.codex', 'sessions')
}

function resolveClaudeProjectsRoot() {
  return path.join(resolveHomeDir(), '.claude', 'projects')
}

function makeDayKeys(days: number) {
  const keys: string[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const next = new Date(today)
    next.setDate(today.getDate() - offset)
    keys.push(formatDayKey(next))
  }
  return keys
}

function formatDayKey(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayDirectoryForKey(root: string, dayKey: string) {
  const [year = '1970', month = '01', day = '01'] = dayKey.split('-')
  return path.join(root, year, month, day)
}

async function listJsonlFilesInDayRoots(root: string, dayKeys: string[]) {
  const files = new Set<string>()
  for (const dayKey of dayKeys) {
    const dayDir = dayDirectoryForKey(root, dayKey)
    try {
      const entries = await readdir(dayDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.add(path.join(dayDir, entry.name))
        }
      }
    } catch {
      // Day directory missing or unreadable.
    }
  }
  return [...files]
}

function parseJsonLine<T>(line: string): T | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

function readTimestampMs(value: Record<string, unknown>) {
  const raw = value.timestamp
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof raw === 'number') {
    return raw > 0 && raw < 1_000_000_000_000 ? raw * 1000 : raw
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readNumberFromMap(map: Record<string, unknown> | null, keys: string[]) {
  if (!map) {
    return 0
  }
  for (const key of keys) {
    const value = map[key]
    if (typeof value === 'number') {
      return value
    }
  }
  return 0
}

function extractModelFromTurnContext(value: Record<string, unknown>) {
  const payload = asRecord(value.payload)
  if (!payload) {
    return null
  }
  if (typeof payload.model === 'string' && payload.model.trim().length > 0) {
    return payload.model
  }
  const info = asRecord(payload.info)
  if (info && typeof info.model === 'string' && info.model.trim().length > 0) {
    return info.model
  }
  return null
}

function extractModelFromTokenCount(value: Record<string, unknown>) {
  const payload = asRecord(value.payload)
  const info = asRecord(payload?.info)
  const model = info?.model ?? info?.model_name ?? payload?.model ?? value.model
  return typeof model === 'string' && model.trim().length > 0 ? model : null
}

function extractTokenDelta(
  info: Record<string, unknown> | null,
  previousTotals: UsageTotals | null
): { delta: UsageTotals; nextTotals: UsageTotals | null } | null {
  if (!info) {
    return null
  }
  const totalTokenUsage = asRecord(info.total_token_usage ?? info.totalTokenUsage)
  const lastTokenUsage = asRecord(info.last_token_usage ?? info.lastTokenUsage)

  if (totalTokenUsage) {
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

  if (lastTokenUsage) {
    const delta = {
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

  return null
}

function consumeCodexUsageTokenCount(
  aggregate: CodexUsageAggregate,
  payload: Record<string, unknown>,
  previousTotals: UsageTotals | null,
  currentModel: string | null,
  modelsSeenInSession: Set<string>
) {
  const next = extractTokenDelta(asRecord(payload.info), previousTotals)
  if (!next) {
    return { previousTotals, currentModel }
  }
  const nextTotals = next.nextTotals
  const cached = Math.min(next.delta.cached, next.delta.input)
  if (next.delta.input === 0 && cached === 0 && next.delta.output === 0) {
    return { previousTotals: nextTotals, currentModel }
  }

  aggregate.inputTokens += next.delta.input
  aggregate.cacheReadTokens += cached
  aggregate.outputTokens += next.delta.output

  const model = currentModel ?? extractModelFromTokenCount({ payload }) ?? 'unknown'
  const previousUsage = aggregate.modelUsage.get(model) ?? { input: 0, cached: 0, output: 0 }
  aggregate.modelUsage.set(model, {
    input: previousUsage.input + next.delta.input,
    cached: previousUsage.cached + cached,
    output: previousUsage.output + next.delta.output,
  })
  modelsSeenInSession.add(model)
  return { previousTotals: nextTotals, currentModel: model }
}

export async function readClaudeUsageStats(): Promise<ProviderUsageStats> {
  const jsonlFiles = await findJsonlFiles(resolveClaudeProjectsRoot())
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let totalCost = 0
  const modelCounts = new Map<string, number>()
  let sessions7d = 0
  let sessions30d = 0
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

  for (const filePath of jsonlFiles) {
    try {
      const stats = await stat(filePath)
      const modifiedAt = stats.mtimeMs
      if (modifiedAt >= thirtyDaysAgo) {
        sessions30d += 1
      }
      if (modifiedAt >= sevenDaysAgo) {
        sessions7d += 1
      }
    } catch {
      // Ignore stat failures.
    }

    try {
      const content = await readFile(filePath, 'utf-8')
      for (const line of content.split('\n')) {
        const parsed = parseJsonLine<ClaudeJsonlLine>(line)
        if (!parsed || parsed.type !== 'assistant' || !parsed.message?.usage) {
          continue
        }
        const usage = parsed.message.usage
        const lineInput = usage.input_tokens ?? 0
        const lineOutput = usage.output_tokens ?? 0
        const lineCacheRead = usage.cache_read_input_tokens ?? 0
        inputTokens += lineInput
        outputTokens += lineOutput
        cacheReadTokens += lineCacheRead
        if (parsed.message.model) {
          modelCounts.set(parsed.message.model, (modelCounts.get(parsed.message.model) ?? 0) + 1)
          totalCost += estimateCost(parsed.message.model, lineInput, lineCacheRead, lineOutput)
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }

  const topModels = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)

  return {
    totalThreads: jsonlFiles.length,
    sessions7d,
    sessions30d,
    totalSessions: sessions30d,
    modelCount: modelCounts.size,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalCost,
    topModels,
    updatedAt: now,
  }
}

async function scanCodexUsageFiles(filePaths: string[]): Promise<CodexUsageAggregate> {
  const aggregate: CodexUsageAggregate = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    modelUsage: new Map(),
    modelSessionCounts: new Map<string, number>(),
    updatedAt: 0,
  }

  for (const filePath of filePaths) {
    let previousTotals: UsageTotals | null = null
    let currentModel: string | null = null
    const modelsSeenInSession = new Set<string>()

    try {
      const content = await readFile(filePath, 'utf-8')
      for (const line of content.split('\n')) {
        const parsed = parseJsonLine<Record<string, unknown>>(line)
        if (!parsed) {
          continue
        }
        const timestampMs = readTimestampMs(parsed)
        if (timestampMs) {
          aggregate.updatedAt = Math.max(aggregate.updatedAt, timestampMs)
        }

        if (parsed.type === 'turn_context') {
          currentModel = extractModelFromTurnContext(parsed) ?? currentModel
          continue
        }
        if (parsed.type !== 'event_msg' && parsed.type !== '') {
          continue
        }
        const payload = asRecord(parsed.payload)
        if (!payload || payload.type !== 'token_count') {
          continue
        }
        const next = consumeCodexUsageTokenCount(
          aggregate,
          payload,
          previousTotals,
          currentModel,
          modelsSeenInSession
        )
        previousTotals = next.previousTotals
        currentModel = next.currentModel
      }
    } catch {
      // Skip unreadable session files.
    }

    for (const model of modelsSeenInSession) {
      aggregate.modelSessionCounts.set(model, (aggregate.modelSessionCounts.get(model) ?? 0) + 1)
    }
  }

  return aggregate
}

export async function readCodexUsageStats(): Promise<ProviderUsageStats> {
  const sessionsRoot = resolveCodexSessionsRoot()
  const totalThreadFiles = await findJsonlFiles(sessionsRoot)
  const dayKeys30 = makeDayKeys(30)
  const dayKeys7 = dayKeys30.slice(-7)
  const files30 = await listJsonlFilesInDayRoots(sessionsRoot, dayKeys30)
  const files7 = await listJsonlFilesInDayRoots(sessionsRoot, dayKeys7)
  const aggregate = await scanCodexUsageFiles(files30)

  let totalCost = 0
  for (const [model, usage] of aggregate.modelUsage.entries()) {
    totalCost += estimateCost(model, usage.input, usage.cached, usage.output)
  }

  const topModels = [...aggregate.modelSessionCounts.entries()]
    .filter(([model]) => model !== 'unknown')
    .map(([model, count]) => ({ model, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)

  return {
    totalThreads: totalThreadFiles.length,
    sessions7d: files7.length,
    sessions30d: files30.length,
    totalSessions: files30.length,
    modelCount: [...aggregate.modelSessionCounts.keys()].filter(model => model !== 'unknown')
      .length,
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    cacheReadTokens: aggregate.cacheReadTokens,
    totalCost,
    topModels,
    updatedAt: aggregate.updatedAt || Date.now(),
  }
}
