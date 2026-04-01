import { mkdir, appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AppDiagnosticEntry, AppDiagnosticInput } from '../../shared/ipc'

const MAX_DIAGNOSTIC_ENTRIES = 2000
const DEFAULT_READ_LIMIT = 500

export class DiagnosticsService {
  private readonly logPath: string

  private entries: AppDiagnosticEntry[] = []

  constructor(logDirectory?: string) {
    const baseDirectory = logDirectory ?? path.join(app.getPath('userData'), 'logs')
    this.logPath = path.join(baseDirectory, 'diagnostics.jsonl')
  }

  async hydrate() {
    try {
      const raw = await readFile(this.logPath, 'utf8')
      const entries = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line) as AppDiagnosticEntry
          } catch {
            return null
          }
        })
        .filter((entry): entry is AppDiagnosticEntry => entry !== null)
      this.entries = entries.slice(-MAX_DIAGNOSTIC_ENTRIES)
    } catch {
      this.entries = []
    }
  }

  list(limit = DEFAULT_READ_LIMIT) {
    return this.entries.slice(-Math.max(0, limit))
  }

  async record(input: AppDiagnosticInput) {
    const entry: AppDiagnosticEntry = {
      id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...input,
    }
    this.entries = [...this.entries, entry].slice(-MAX_DIAGNOSTIC_ENTRIES)
    try {
      await mkdir(path.dirname(this.logPath), { recursive: true })
      await appendFile(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // best effort only; diagnostics should never crash the app
    }
    return entry
  }
}
