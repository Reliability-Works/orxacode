import { makeProviderRuntimeSessionKey, type ProviderSessionDirectory } from './provider-session-directory'
import { asRecord, asString, buildBindingRuntimePayload } from './codex-service-parsers'

export function findBindingForThread(
  providerSessionDirectory: ProviderSessionDirectory | null,
  threadId: string
) {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    return null
  }
  return (
    (providerSessionDirectory?.list('codex') ?? []).find(binding => {
      const cursor = asRecord(binding.resumeCursor)
      return asString(cursor?.threadId).trim() === normalizedThreadId
    }) ?? null
  )
}

export function seedBindingFromLegacyThread(
  providerSessionDirectory: ProviderSessionDirectory | null,
  threadId: string,
  cwd?: string
) {
  const normalizedThreadId = threadId.trim()
  const normalizedCwd = cwd?.trim() || ''
  if (!normalizedThreadId || !normalizedCwd || !providerSessionDirectory) {
    return null
  }
  const sessionKey = makeProviderRuntimeSessionKey('codex', normalizedCwd, normalizedThreadId)
  const raw = providerSessionDirectory.getLegacyRendererValue(`orxa:codexSession:v1:${sessionKey}`)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { thread?: { id?: unknown } | null }
    const legacyThreadId = typeof parsed.thread?.id === 'string' ? parsed.thread.id.trim() : ''
    if (legacyThreadId !== normalizedThreadId) {
      return null
    }
    return providerSessionDirectory.upsert({
      provider: 'codex',
      sessionKey,
      status: 'running',
      resumeCursor: { threadId: normalizedThreadId },
      runtimePayload: { directory: normalizedCwd },
    })
  } catch {
    return null
  }
}

export function upsertBindingForThread(
  providerSessionDirectory: ProviderSessionDirectory | null,
  threadId: string,
  input?: {
    cwd?: string
    model?: string
    reasoningEffort?: string | null
    collaborationMode?: string
    status?: 'starting' | 'running' | 'stopped' | 'error'
  }
) {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId || !providerSessionDirectory) {
    return null
  }
  const existing = findBindingForThread(providerSessionDirectory, normalizedThreadId)
  const normalizedCwd =
    input?.cwd?.trim() || asString(asRecord(existing?.runtimePayload)?.directory).trim()
  const sessionKey =
    existing?.sessionKey ??
    (normalizedCwd
      ? makeProviderRuntimeSessionKey('codex', normalizedCwd, normalizedThreadId)
      : '')
  if (!sessionKey) {
    return existing ?? null
  }
  return providerSessionDirectory.upsert({
    provider: 'codex',
    sessionKey,
    status: input?.status ?? 'running',
    resumeCursor: { threadId: normalizedThreadId },
    runtimePayload: buildBindingRuntimePayload(normalizedCwd, input),
  })
}
