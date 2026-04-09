import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelCapabilities,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from '@orxa-code/contracts'
import { normalizeModelSlug } from '@orxa-code/shared/model'

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
}

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind
): ReadonlyArray<ServerProviderModel> {
  return providers.find(candidate => candidate.provider === provider)?.models ?? []
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind
): ServerProvider | undefined {
  return providers.find(candidate => candidate.provider === provider)
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind | null | undefined
): ProviderKind {
  const requested = provider ?? 'codex'
  if (isProviderEnabled(providers, requested)) {
    return requested
  }
  return providers.find(candidate => candidate.enabled)?.provider ?? requested
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderKind
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider)
  return models.find(candidate => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES
}

/**
 * Whether a model explicitly advertises reasoning-effort support.
 *
 * The server populates `supportsReasoning` on every `ServerProviderModel`.
 * Legacy snapshots that lack the field are treated as `false` so the
 * composer never shows a reasoning selector for models it cannot confirm.
 */
export function modelSupportsReasoning(model: ServerProviderModel | undefined): boolean {
  return model?.supportsReasoning === true
}

export function findProviderModel(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderKind
): ServerProviderModel | undefined {
  const slug = normalizeModelSlug(model, provider)
  return models.find(candidate => candidate.slug === slug)
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind
): string {
  const models = getProviderModels(providers, provider)
  return (
    models.find(model => !model.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider]
  )
}
