import type { PersistenceService } from './persistence-service'

export type ProviderRuntimeProvider = 'claude-chat' | 'codex' | 'opencode'
export type ProviderRuntimeStatus = 'starting' | 'running' | 'stopped' | 'error'

export type ProviderRuntimeBinding = {
  provider: ProviderRuntimeProvider
  sessionKey: string
  status: ProviderRuntimeStatus
  resumeCursor: unknown | null
  runtimePayload: Record<string, unknown> | null
  updatedAt: string
}

export type ProviderRuntimeBindingInput = {
  provider: ProviderRuntimeProvider
  sessionKey: string
  status?: ProviderRuntimeStatus
  resumeCursor?: unknown | null
  runtimePayload?: Record<string, unknown> | null
}

const PROVIDER_RUNTIME_NAMESPACE = 'provider-runtime:v1'

export function makeProviderRuntimeSessionKey(
  provider: ProviderRuntimeProvider,
  directory: string,
  externalID: string
) {
  return `${provider}::${directory}::${externalID}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeRuntimePayload(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown> | null | undefined
) {
  if (next === undefined) {
    return existing
  }
  if (existing && next) {
    return { ...existing, ...next }
  }
  return next ?? null
}

function parseBinding(raw: string | null): ProviderRuntimeBinding | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ProviderRuntimeBinding>
    if (
      (parsed.provider !== 'claude-chat' &&
        parsed.provider !== 'codex' &&
        parsed.provider !== 'opencode') ||
      typeof parsed.sessionKey !== 'string' ||
      (parsed.status !== 'starting' &&
        parsed.status !== 'running' &&
        parsed.status !== 'stopped' &&
        parsed.status !== 'error') ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }
    return {
      provider: parsed.provider,
      sessionKey: parsed.sessionKey,
      status: parsed.status,
      resumeCursor: parsed.resumeCursor ?? null,
      runtimePayload: isRecord(parsed.runtimePayload) ? parsed.runtimePayload : null,
      updatedAt: parsed.updatedAt,
    }
  } catch {
    return null
  }
}

export class ProviderSessionDirectory {
  private readonly inMemory = new Map<string, ProviderRuntimeBinding>()
  private readonly persistenceService?: PersistenceService

  constructor(persistenceService?: PersistenceService) {
    this.persistenceService = persistenceService
  }

  getLegacyRendererValue(key: string): string | null {
    return this.persistenceService?.getRendererValue(key) ?? null
  }

  setLegacyRendererValue(key: string, value: string) {
    this.persistenceService?.setRendererValue(key, value)
  }

  removeLegacyRendererValue(key: string) {
    this.persistenceService?.removeRendererValue(key)
  }

  getBinding(
    sessionKey: string,
    provider?: ProviderRuntimeProvider
  ): ProviderRuntimeBinding | null {
    const normalizedSessionKey = sessionKey.trim()
    if (!normalizedSessionKey) {
      return null
    }
    const parsed = this.persistenceService
      ? parseBinding(
          this.persistenceService.getValue(PROVIDER_RUNTIME_NAMESPACE, normalizedSessionKey)
        )
      : (this.inMemory.get(normalizedSessionKey) ?? null)
    if (!parsed) {
      return null
    }
    if (provider && parsed.provider !== provider) {
      return null
    }
    return parsed
  }

  upsert(input: ProviderRuntimeBindingInput): ProviderRuntimeBinding {
    const normalizedSessionKey = input.sessionKey.trim()
    if (!normalizedSessionKey) {
      throw new Error('sessionKey is required')
    }
    const existing = this.getBinding(normalizedSessionKey, input.provider)
    const next: ProviderRuntimeBinding = {
      provider: input.provider,
      sessionKey: normalizedSessionKey,
      status: input.status ?? existing?.status ?? 'running',
      resumeCursor:
        input.resumeCursor !== undefined ? input.resumeCursor : (existing?.resumeCursor ?? null),
      runtimePayload: mergeRuntimePayload(existing?.runtimePayload ?? null, input.runtimePayload),
      updatedAt: new Date().toISOString(),
    }
    if (this.persistenceService) {
      this.persistenceService.setValue(
        PROVIDER_RUNTIME_NAMESPACE,
        normalizedSessionKey,
        JSON.stringify(next)
      )
    } else {
      this.inMemory.set(normalizedSessionKey, next)
    }
    return next
  }

  remove(sessionKey: string, provider?: ProviderRuntimeProvider) {
    const normalizedSessionKey = sessionKey.trim()
    if (!normalizedSessionKey) {
      return
    }
    const existing = this.getBinding(normalizedSessionKey)
    if (!existing) {
      return
    }
    if (provider && existing.provider !== provider) {
      return
    }
    if (this.persistenceService) {
      this.persistenceService.removeValue(PROVIDER_RUNTIME_NAMESPACE, normalizedSessionKey)
    } else {
      this.inMemory.delete(normalizedSessionKey)
    }
  }

  list(provider?: ProviderRuntimeProvider): ProviderRuntimeBinding[] {
    const bindings = this.persistenceService
      ? this.persistenceService
          .listValues(PROVIDER_RUNTIME_NAMESPACE)
          .map(row => parseBinding(row.value))
          .filter((row): row is ProviderRuntimeBinding => Boolean(row))
      : [...this.inMemory.values()]
    return provider ? bindings.filter(binding => binding.provider === provider) : bindings
  }
}
