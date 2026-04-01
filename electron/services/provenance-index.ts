import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { ChangeProvenanceRecord, SessionProvenanceSnapshot } from '../../shared/ipc'

const PROVENANCE_DIR_NAME = 'change-provenance'
const MAX_PROVENANCE_SIZE_BYTES = 3 * 1024 * 1024
const COMPACT_KEEP_LINES = 6_000

function stableKey(directory: string, sessionID: string) {
  return createHash('sha256').update(`${directory}::${sessionID}`).digest('hex')
}

function parseLine(line: string): ChangeProvenanceRecord | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(line) as ChangeProvenanceRecord
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (typeof parsed.eventID !== 'string' || typeof parsed.filePath !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export class ProvenanceIndex {
  private async rootDir() {
    const dir = path.join(app.getPath('userData'), PROVENANCE_DIR_NAME)
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
        .filter((item): item is ChangeProvenanceRecord => Boolean(item))
    } catch {
      return []
    }
  }

  async appendMany(directory: string, sessionID: string, records: ChangeProvenanceRecord[]) {
    if (records.length === 0) {
      return
    }
    const existing = await this.loadAll(directory, sessionID)
    const known = new Set(existing.map(item => item.eventID))
    const unique: ChangeProvenanceRecord[] = []
    for (const item of records) {
      if (known.has(item.eventID)) {
        continue
      }
      known.add(item.eventID)
      unique.push(item)
    }
    if (unique.length === 0) {
      return
    }
    const next = [...existing, ...unique]
    const file = await this.filePath(directory, sessionID)
    const payload = `${next.map(item => JSON.stringify(item)).join('\n')}\n`
    await writeFile(file, payload, 'utf8')
    await this.compactIfNeeded(directory, sessionID)
  }

  async loadSnapshot(
    directory: string,
    sessionID: string,
    cursor = 0
  ): Promise<SessionProvenanceSnapshot> {
    const all = await this.loadAll(directory, sessionID)
    const start = Math.max(0, Number.isFinite(cursor) ? Math.floor(cursor) : 0)
    return {
      cursor: all.length,
      records: all.slice(start),
    }
  }

  async getFileHistory(directory: string, sessionID: string, relativePath: string) {
    const normalized = relativePath.replace(/\\/g, '/')
    const all = await this.loadAll(directory, sessionID)
    return all
      .filter(record => record.filePath.replace(/\\/g, '/') === normalized)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  async clear(directory: string, sessionID: string) {
    const file = await this.filePath(directory, sessionID)
    await rm(file, { force: true })
  }

  private async compactIfNeeded(directory: string, sessionID: string) {
    const file = await this.filePath(directory, sessionID)
    try {
      const info = await stat(file)
      if (info.size <= MAX_PROVENANCE_SIZE_BYTES) {
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
