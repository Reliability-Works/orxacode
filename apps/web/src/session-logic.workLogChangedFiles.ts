import { asObjectRecord, asTrimmedString } from '@orxa-code/shared/records'

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value)
  if (!normalized || seen.has(normalized)) {
    return
  }
  seen.add(normalized)
  target.push(normalized)
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1)
      if (target.length >= 12) {
        return
      }
    }
    return
  }

  const record = asObjectRecord(value)
  if (!record) {
    return
  }

  pushChangedFile(target, seen, record.path)
  pushChangedFile(target, seen, record.filePath)
  pushChangedFile(target, seen, record.file_path)
  pushChangedFile(target, seen, record.relativePath)
  pushChangedFile(target, seen, record.relative_path)
  pushChangedFile(target, seen, record.filename)
  pushChangedFile(target, seen, record.newPath)
  pushChangedFile(target, seen, record.new_path)
  pushChangedFile(target, seen, record.oldPath)
  pushChangedFile(target, seen, record.old_path)

  for (const nestedKey of [
    'item',
    'result',
    'input',
    'data',
    'changes',
    'files',
    'edits',
    'patch',
    'patches',
    'operations',
  ]) {
    if (!(nestedKey in record)) {
      continue
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1)
    if (target.length >= 12) {
      return
    }
  }
}

export function extractChangedFilesFromPayload(
  payload: Record<string, unknown> | null,
  isFileChange: boolean
): string[] {
  if (!isFileChange) {
    return []
  }
  const changedFiles: string[] = []
  const seen = new Set<string>()
  collectChangedFiles(asObjectRecord(payload?.data), changedFiles, seen, 0)
  return changedFiles
}

const COMMAND_FILE_OP_TOKENS = new Set(['rm', 'rmdir', 'unlink', 'touch', 'mkdir'])

function isFileArg(token: string): boolean {
  if (token.length === 0) return false
  if (token.startsWith('-')) return false
  return true
}

function unquote(token: string): string {
  if (token.length < 2) return token
  const first = token[0]
  const last = token[token.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return token.slice(1, -1)
  }
  return token
}

function extractFilesFromSegment(segment: string): string[] {
  const stripped = segment.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/u, '').trim()
  const tokens = stripped.split(/\s+/u).filter(part => part.length > 0)
  const [first, ...rest] = tokens
  if (!first) return []
  const base = (first.split(/[\\/]/).pop() ?? first).toLowerCase()
  if (!COMMAND_FILE_OP_TOKENS.has(base)) return []
  const files: string[] = []
  for (const token of rest) {
    if (!isFileArg(token)) continue
    const cleaned = unquote(token)
    if (cleaned.length > 0) files.push(cleaned)
  }
  return files
}

export function extractChangedFilesFromCommand(command: string | undefined): string[] {
  if (!command) return []
  const segments = command.split(/\|\|?|&&|;/u)
  const files: string[] = []
  const seen = new Set<string>()
  for (const segment of segments) {
    for (const path of extractFilesFromSegment(segment)) {
      if (seen.has(path)) continue
      seen.add(path)
      files.push(path)
    }
  }
  return files
}
