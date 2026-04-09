/**
 * Filesystem helpers shared by the Codex and Claude usage scanners.
 *
 * The session-log directories are user-scoped and may not exist. All helpers
 * swallow missing-path / permission errors so a totally absent directory maps
 * to "no sessions" instead of a thrown exception.
 *
 * @module ProviderUsageQuery.fs
 */
import fsPromises from 'node:fs/promises'
import path from 'node:path'

export async function findJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await findJsonlFiles(fullPath)))
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory missing or unreadable — treat as empty.
  }
  return results
}

function resolveHomeDir(): string {
  return process.env.HOME ?? ''
}

export function resolveCodexSessionsRoot(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  if (codexHome && codexHome.length > 0) {
    return path.join(codexHome, 'sessions')
  }
  return path.join(resolveHomeDir(), '.codex', 'sessions')
}

export function resolveClaudeProjectsRoot(): string {
  return path.join(resolveHomeDir(), '.claude', 'projects')
}

function formatDayKey(value: Date): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function makeDayKeys(days: number): string[] {
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

function dayDirectoryForKey(root: string, dayKey: string): string {
  const [year = '1970', month = '01', day = '01'] = dayKey.split('-')
  return path.join(root, year, month, day)
}

export async function listJsonlFilesInDayRoots(
  root: string,
  dayKeys: ReadonlyArray<string>
): Promise<string[]> {
  const files = new Set<string>()
  for (const dayKey of dayKeys) {
    const dayDir = dayDirectoryForKey(root, dayKey)
    try {
      const entries = await fsPromises.readdir(dayDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.add(path.join(dayDir, entry.name))
        }
      }
    } catch {
      // Day directory missing — skip.
    }
  }
  return [...files]
}

export function parseJsonLine<T>(line: string): T | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readNumberFromMap(
  map: Record<string, unknown> | null,
  keys: ReadonlyArray<string>
): number {
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

export function readTimestampMs(value: Record<string, unknown>): number | null {
  const raw = value['timestamp']
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof raw === 'number') {
    return raw > 0 && raw < 1_000_000_000_000 ? raw * 1000 : raw
  }
  return null
}

export async function safeStatMtimeMs(filePath: string): Promise<number | null> {
  try {
    const stats = await fsPromises.stat(filePath)
    return stats.mtimeMs
  } catch {
    return null
  }
}

export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}
