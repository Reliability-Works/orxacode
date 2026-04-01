import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { ExecutionEventRecord, ExecutionLedgerSnapshot } from '../../shared/ipc'

const LEDGER_DIR_NAME = 'execution-ledger'
const MAX_LEDGER_SIZE_BYTES = 5 * 1024 * 1024
const COMPACT_KEEP_LINES = 4_000

function stableKey(directory: string, sessionID: string) {
  return createHash('sha256').update(`${directory}::${sessionID}`).digest('hex')
}

function parseLine(line: string): ExecutionEventRecord | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(line) as ExecutionEventRecord
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (typeof parsed.id !== 'string' || typeof parsed.timestamp !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export class ExecutionLedgerStore {
  private async rootDir() {
    const dir = path.join(app.getPath('userData'), LEDGER_DIR_NAME)
    await mkdir(dir, { recursive: true })
    return dir
  }

  private async filePath(directory: string, sessionID: string) {
    const root = await this.rootDir()
    return path.join(root, `${stableKey(directory, sessionID)}.jsonl`)
  }

  private async loadAll(directory: string, sessionID: string) {
    const file = await this.filePath(directory, sessionID)
    try {
      const content = await readFile(file, 'utf8')
      return content
        .split(/\r?\n/)
        .map(line => parseLine(line))
        .filter((item): item is ExecutionEventRecord => Boolean(item))
    } catch {
      return []
    }
  }

  async append(directory: string, sessionID: string, record: ExecutionEventRecord) {
    return this.appendMany(directory, sessionID, [record])
  }

  async appendMany(directory: string, sessionID: string, records: ExecutionEventRecord[]) {
    if (records.length === 0) {
      return
    }
    const existing = await this.loadAll(directory, sessionID)
    const known = new Set(existing.map(item => item.id))
    const unique = records.filter(item => !known.has(item.id))
    if (unique.length === 0) {
      return
    }
    const next = [...existing, ...unique]
    const file = await this.filePath(directory, sessionID)
    const serialized = `${next.map(item => JSON.stringify(item)).join('\n')}\n`
    await writeFile(file, serialized, 'utf8')
    await this.compactIfNeeded(directory, sessionID)
  }

  async loadSnapshot(
    directory: string,
    sessionID: string,
    cursor = 0
  ): Promise<ExecutionLedgerSnapshot> {
    const all = await this.loadAll(directory, sessionID)
    const start = Math.max(0, Number.isFinite(cursor) ? Math.floor(cursor) : 0)
    return {
      cursor: all.length,
      records: all.slice(start),
    }
  }

  async clear(directory: string, sessionID: string) {
    const file = await this.filePath(directory, sessionID)
    await rm(file, { force: true })
  }

  private async compactIfNeeded(directory: string, sessionID: string) {
    const file = await this.filePath(directory, sessionID)
    try {
      const info = await stat(file)
      if (info.size <= MAX_LEDGER_SIZE_BYTES) {
        return
      }
      const all = await this.loadAll(directory, sessionID)
      const compacted = all.slice(Math.max(0, all.length - COMPACT_KEEP_LINES))
      const tempPath = `${file}.tmp`
      const payload = `${compacted.map(item => JSON.stringify(item)).join('\n')}\n`
      await writeFile(tempPath, payload, 'utf8')
      await rename(tempPath, file)
    } catch {
      // Best effort compaction only.
    }
  }
}
