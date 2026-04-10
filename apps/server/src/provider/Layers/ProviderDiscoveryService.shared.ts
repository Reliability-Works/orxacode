import fsPromises from 'node:fs/promises'
import type { ProviderListPluginsResult, ProviderPluginDescriptor } from '@orxa-code/contracts'

export function nowIso(): string {
  return new Date().toISOString()
}

export function uniqueById<T extends { id: string }>(items: ReadonlyArray<T>): ReadonlyArray<T> {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function trimString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString).map(entry => entry.trim()) : []
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function safeReadJson(
  filePath: string
): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }
> {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8')
    return { ok: true, value: JSON.parse(content) }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

export function compactOptionalFields<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

export function finalizePluginResult(input: {
  plugins: ReadonlyArray<ProviderPluginDescriptor>
  warnings: ReadonlyArray<ProviderListPluginsResult['warnings'][number]>
}): ProviderListPluginsResult {
  return {
    plugins: uniqueById(
      [...input.plugins].toSorted(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      )
    ),
    warnings: [...input.warnings],
    updatedAt: nowIso(),
  }
}

export async function readObjectManifest(input: {
  manifestPath: string
  readErrorMessage: (error: string) => string
  invalidMessage: string
}): Promise<
  { ok: true; record: Record<string, unknown> } | { ok: false; result: ProviderListPluginsResult }
> {
  const manifest = await safeReadJson(input.manifestPath)
  if (!manifest.ok) {
    return {
      ok: false,
      result: finalizePluginResult({
        plugins: [],
        warnings: [
          {
            path: input.manifestPath,
            message: input.readErrorMessage(manifest.error),
          },
        ],
      }),
    }
  }

  const record =
    manifest.value && typeof manifest.value === 'object' && !Array.isArray(manifest.value)
      ? (manifest.value as Record<string, unknown>)
      : null
  if (!record) {
    return {
      ok: false,
      result: finalizePluginResult({
        plugins: [],
        warnings: [{ path: input.manifestPath, message: input.invalidMessage }],
      }),
    }
  }

  return { ok: true, record }
}
