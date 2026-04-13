import * as FS from 'node:fs'
import * as Path from 'node:path'

interface ReadPersistedJsonFileOptions<T> {
  filePath: string
  fallback: () => T
  sanitize: (raw: unknown) => T
}

export function readPersistedJsonFile<T>({
  filePath,
  fallback,
  sanitize,
}: ReadPersistedJsonFileOptions<T>): T {
  try {
    const raw = FS.readFileSync(filePath, 'utf-8')
    return sanitize(JSON.parse(raw))
  } catch {
    return fallback()
  }
}

export function writePersistedJsonFile<T>(filePath: string, value: T): void {
  FS.mkdirSync(Path.dirname(filePath), { recursive: true })
  FS.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}
