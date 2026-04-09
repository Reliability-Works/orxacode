/**
 * Dynamic discovery of opencode-configured providers and models.
 *
 * Replaces the static `BUILT_IN_OPENCODE_MODELS` table. Boots a sanitized
 * `opencode serve` subprocess, calls `client.config.providers()` (the
 * `Config` SDK class — `GET /config/providers`), reads
 * `~/.local/share/opencode/auth.json` directly to know which providers the
 * user actually authenticated, and returns the cross-verified intersection
 * with each model the SDK reports for them.
 *
 * The auth.json read is the source of truth: even if opencode reports a
 * provider via env / config / api source, we drop it unless its id appears
 * as a top-level key in auth.json. This is the belt-and-braces guard that
 * keeps env-leaked providers (e.g. `CLOUDFLARE_API_TOKEN`) from showing up
 * in the picker.
 *
 * Promise-based on purpose so the live layer can wrap it in `Cache.make`
 * via `Effect.tryPromise`.
 *
 * @module opencodeDiscovery
 */
import { homedir } from 'node:os'
import { join as joinPath } from 'node:path'
import { readFile } from 'node:fs/promises'

import {
  startOpencodeServer,
  throwIfOpencodeResponseError,
  type OpencodeClientFactory,
  type OpencodeSpawner,
  type StartOpencodeServerInput,
  type StartedOpencodeServer,
} from './opencodeAppServer'

const DEFAULT_AUTH_JSON_RELATIVE = ['.local', 'share', 'opencode', 'auth.json'] as const

export interface DiscoveredOpencodeModel {
  readonly id: string
  readonly providerId: string
  readonly displayName: string
  readonly supportsReasoning: boolean
  readonly variants: ReadonlyArray<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Extract opencode model variant keys from a raw SDK model entry.
 *
 * The opencode SDK generates the `Model` type without a `variants` field,
 * but real provider configs surface it at runtime as a keyed object
 * (e.g. `{ reasoning: {}, turbo: {} }`). We cast through `unknown`,
 * guard the shape, and return the keys. Anything that isn't a plain
 * object (missing, array, string, null) yields an empty list.
 */
export function extractModelVariants(model: unknown): ReadonlyArray<string> {
  if (!isRecord(model)) return []
  const variants = (model as { variants?: unknown }).variants
  if (!isRecord(variants)) return []
  return Object.keys(variants)
}

export interface DiscoverOpencodeProvidersResult {
  readonly configuredProviderIds: ReadonlyArray<string>
  readonly models: ReadonlyArray<DiscoveredOpencodeModel>
}

export type StartOpencodeServerFn = (
  input: StartOpencodeServerInput
) => Promise<StartedOpencodeServer>

export interface DiscoverOpencodeProvidersInput {
  readonly binaryPath: string
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly signal?: AbortSignal | undefined
  readonly spawner?: OpencodeSpawner | undefined
  readonly clientFactory?: OpencodeClientFactory | undefined
  readonly authJsonPath?: string | undefined
  /**
   * Test seam: replaces `startOpencodeServer`. The default boots a real
   * sanitized subprocess. Tests inject a stub returning a fake
   * `OpencodeClient` so they never spawn.
   */
  readonly startServer?: StartOpencodeServerFn | undefined
  /**
   * Test seam: replaces `node:fs/promises#readFile`. Used by the auth.json
   * unit tests to inject malformed / missing payloads.
   */
  readonly readAuthJson?: ((path: string) => Promise<string>) | undefined
  /**
   * Test seam: replaces the warning logger.
   */
  readonly logWarning?: ((message: string) => void) | undefined
}

interface ConfigProvidersResponseLike {
  readonly data?: {
    readonly providers?: ReadonlyArray<DiscoveredProviderRaw>
  }
  readonly error?: unknown
}

interface DiscoveredProviderRaw {
  readonly id?: unknown
  readonly name?: unknown
  readonly models?: Record<string, DiscoveredModelRaw> | undefined
}

interface DiscoveredModelRaw {
  readonly id?: unknown
  readonly name?: unknown
  readonly capabilities?: { readonly reasoning?: unknown } | undefined
}

export function defaultAuthJsonPath(): string {
  return joinPath(homedir(), ...DEFAULT_AUTH_JSON_RELATIVE)
}

async function readConfiguredAuthIds(input: {
  readonly path: string
  readonly readAuthJson: (path: string) => Promise<string>
  readonly logWarning: (message: string) => void
}): Promise<ReadonlySet<string>> {
  let raw: string
  try {
    raw = await input.readAuthJson(input.path)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return new Set()
    }
    input.logWarning(`opencode auth.json read failed at ${input.path}: ${describeError(error)}`)
    return new Set()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    input.logWarning(`opencode auth.json is malformed at ${input.path}: ${describeError(error)}`)
    return new Set()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    input.logWarning(`opencode auth.json is not a JSON object at ${input.path}`)
    return new Set()
  }
  return new Set(Object.keys(parsed as Record<string, unknown>))
}

function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT'
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function unwrapConfigProvidersResponse(
  response: ConfigProvidersResponseLike
): ReadonlyArray<DiscoveredProviderRaw> {
  throwIfOpencodeResponseError(response, 'opencode config.providers')
  const providers = response.data?.providers
  return Array.isArray(providers) ? providers : []
}

function buildDiscoveredModels(
  providers: ReadonlyArray<DiscoveredProviderRaw>,
  authIds: ReadonlySet<string>
): {
  readonly configuredProviderIds: ReadonlyArray<string>
  readonly models: ReadonlyArray<DiscoveredOpencodeModel>
} {
  const keptProviders: Array<{ id: string; models: Record<string, DiscoveredModelRaw> }> = []
  for (const provider of providers) {
    if (typeof provider.id !== 'string') continue
    if (!authIds.has(provider.id)) continue
    const models = provider.models ?? {}
    keptProviders.push({ id: provider.id, models })
  }
  const sortedProviders = [...keptProviders].sort((left, right) => left.id.localeCompare(right.id))
  const configuredProviderIds = sortedProviders.map(entry => entry.id)
  const models: Array<DiscoveredOpencodeModel> = []
  for (const provider of sortedProviders) {
    const modelEntries = Object.entries(provider.models).sort((left, right) =>
      left[0].localeCompare(right[0])
    )
    for (const [modelId, modelRaw] of modelEntries) {
      const displayName =
        typeof modelRaw.name === 'string' && modelRaw.name.trim().length > 0
          ? modelRaw.name.trim()
          : modelId
      const supportsReasoning =
        typeof modelRaw.capabilities?.reasoning === 'boolean'
          ? modelRaw.capabilities.reasoning
          : false
      const variants = extractModelVariants(modelRaw)
      models.push({
        id: `${provider.id}/${modelId}`,
        providerId: provider.id,
        displayName,
        supportsReasoning,
        variants,
      })
    }
  }
  return { configuredProviderIds, models }
}

const noopLogWarning: (message: string) => void = () => {}

const defaultStartServer: StartOpencodeServerFn = input => startOpencodeServer(input)

const defaultReadAuthJson = (path: string): Promise<string> => readFile(path, 'utf8')

export async function discoverOpencodeProviders(
  input: DiscoverOpencodeProvidersInput
): Promise<DiscoverOpencodeProvidersResult> {
  const startServer = input.startServer ?? defaultStartServer
  const readAuthJson = input.readAuthJson ?? defaultReadAuthJson
  const logWarning = input.logWarning ?? noopLogWarning
  const authJsonPath = input.authJsonPath ?? defaultAuthJsonPath()

  const authIds = await readConfiguredAuthIds({
    path: authJsonPath,
    readAuthJson,
    logWarning,
  })
  if (authIds.size === 0) {
    return { configuredProviderIds: [], models: [] }
  }

  const started = await startServer({
    binaryPath: input.binaryPath,
    env: input.env,
    signal: input.signal,
    spawner: input.spawner,
    clientFactory: input.clientFactory,
  })
  try {
    const response = (await started.client.config.providers()) as ConfigProvidersResponseLike
    const providers = unwrapConfigProvidersResponse(response)
    return buildDiscoveredModels(providers, authIds)
  } finally {
    await started.shutdown()
  }
}
