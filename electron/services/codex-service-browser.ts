import type { CodexBrowserThreadSummary, CodexResumeProviderThreadResult } from '@shared/ipc'
import type { ProviderRuntimeBinding, ProviderSessionDirectory } from './provider-session-directory'
import type { CodexServiceThreadOpsContext } from './codex-service-thread-ops'
import { asRecord, asString } from './codex-service-parsers'
import { upsertBindingForThread } from './codex-service-thread-bindings'

type ImportedCodexSession = NonNullable<CodexBrowserThreadSummary['importedSession']>

export type CodexBrowserThreadCache = {
  cachedAt: number
  value: CodexBrowserThreadSummary[]
}

function safeTrim(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const normalized = safeTrim(value)
  if (!normalized) {
    return null
  }
  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) {
    return numeric
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function readThreadPreview(record: Record<string, unknown>) {
  return (
    safeTrim(record.preview) ||
    safeTrim(record.title) ||
    safeTrim(record.summary) ||
    safeTrim(record.name)
  )
}

function readThreadDirectory(record: Record<string, unknown>) {
  return safeTrim(record.cwd) || safeTrim(record.directory)
}

function deriveThreadTitle(record: Record<string, unknown>) {
  const preview = readThreadPreview(record)
  return preview || safeTrim(record.id) || 'Codex Thread'
}

function deriveLastUpdatedAt(record: Record<string, unknown>) {
  return (
    readTimestamp(record.updatedAt) ??
    readTimestamp(record.updated_at) ??
    readTimestamp(record.lastUpdatedAt) ??
    readTimestamp(record.createdAt) ??
    readTimestamp(record.created_at) ??
    Date.now()
  )
}

function buildImportedCodexSessionMap(
  bindings: ProviderRuntimeBinding[]
): Map<string, ImportedCodexSession> {
  const imported = new Map<string, ImportedCodexSession>()
  for (const binding of bindings) {
    const resumeCursor = asRecord(binding.resumeCursor)
    const threadId = asString(resumeCursor?.threadId).trim()
    if (!threadId) {
      continue
    }
    const separatorIndex = binding.sessionKey.lastIndexOf('::')
    if (separatorIndex <= 0) {
      continue
    }
    const directory =
      safeTrim(asRecord(binding.runtimePayload)?.directory) ||
      binding.sessionKey.slice(0, separatorIndex)
    const sessionID = binding.sessionKey.slice(separatorIndex + 2).trim()
    if (!directory || !sessionID) {
      continue
    }
    imported.set(threadId, {
      sessionKey: binding.sessionKey,
      sessionID,
      directory,
    })
  }
  return imported
}

async function listCodexThreadRecordsForBrowser(
  context: CodexServiceThreadOpsContext
): Promise<Record<string, unknown>[]> {
  await context.ensureConnected()
  const threadRecords: Record<string, unknown>[] = []
  let cursor: string | null | undefined
  do {
    const result = asRecord(
      await context.request('thread/list', { cursor, limit: 100, archived: false })
    )
    const threads = Array.isArray(result?.threads) ? result.threads : []
    threadRecords.push(
      ...threads
        .map(thread => asRecord(thread))
        .filter((thread): thread is Record<string, unknown> => Boolean(thread))
    )
    const nextCursor = asString(result?.nextCursor).trim()
    cursor = nextCursor || undefined
  } while (cursor)
  return threadRecords
}

export async function listCodexBrowserThreadsWithCache(args: {
  cachedBrowserThreads: CodexBrowserThreadCache | null
  providerSessionDirectory: ProviderSessionDirectory | null
  context: CodexServiceThreadOpsContext
}) {
  const now = Date.now()
  if (args.cachedBrowserThreads && now - args.cachedBrowserThreads.cachedAt < 5_000) {
    return args.cachedBrowserThreads
  }
  const importedSessionsByThreadId = buildImportedCodexSessionMap(
    args.providerSessionDirectory?.list('codex') ?? []
  )
  const threadRecords = await listCodexThreadRecordsForBrowser(args.context)
  return {
    cachedAt: now,
    value: threadRecords
      .flatMap(record => {
        const threadId = asString(record.id).trim()
        if (!threadId) {
          return []
        }
        const preview = readThreadPreview(record)
        const cwd = readThreadDirectory(record)
        return [{
          threadId,
          title: deriveThreadTitle(record),
          lastUpdatedAt: deriveLastUpdatedAt(record),
          ...(cwd ? { cwd } : {}),
          ...(preview ? { preview } : {}),
          isArchived: false,
          ...(importedSessionsByThreadId.has(threadId)
            ? { importedSession: importedSessionsByThreadId.get(threadId) }
            : {}),
        } satisfies CodexBrowserThreadSummary]
      })
      .sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt),
  } satisfies CodexBrowserThreadCache
}

export async function resumeCodexProviderThread(args: {
  threadId: string
  directory: string
  threads: CodexBrowserThreadSummary[]
  providerSessionDirectory: ProviderSessionDirectory | null
  context: CodexServiceThreadOpsContext
}) {
  const normalizedThreadId = args.threadId.trim()
  const normalizedDirectory = args.directory.trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  if (!normalizedDirectory) {
    throw new Error('directory is required')
  }

  const matchingThread = args.threads.find(thread => thread.threadId === normalizedThreadId)
  if (!matchingThread) {
    throw new Error('Codex thread not found')
  }

  if (matchingThread.importedSession) {
    return {
      threadId: normalizedThreadId,
      sessionKey: matchingThread.importedSession.sessionKey,
      sessionID: matchingThread.importedSession.sessionID,
      directory: matchingThread.importedSession.directory,
      title: matchingThread.title,
    } satisfies CodexResumeProviderThreadResult
  }

  await args.context.resumeThread(normalizedThreadId)
  const binding = upsertBindingForThread(args.providerSessionDirectory, normalizedThreadId, {
    cwd: normalizedDirectory,
    status: 'running',
  })
  const sessionKey = binding?.sessionKey ?? `${normalizedDirectory}::${normalizedThreadId}`
  return {
    threadId: normalizedThreadId,
    sessionKey,
    sessionID: normalizedThreadId,
    directory: normalizedDirectory,
    title: matchingThread.title,
  } satisfies CodexResumeProviderThreadResult
}
