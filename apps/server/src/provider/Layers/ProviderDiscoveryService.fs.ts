import type { Dirent } from 'node:fs'
import fsPromises from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { ProviderListPluginsResult, ProviderPluginDescriptor } from '@orxa-code/contracts'
import {
  compactOptionalFields,
  finalizePluginResult,
  nowIso,
  readObjectManifest,
  readStringArray,
  safeReadJson,
  trimString,
} from './ProviderDiscoveryService.shared.ts'

async function safeReadDir(dirPath: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await fsPromises.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function safeExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

function codexInterfaceRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  return record.interface &&
    typeof record.interface === 'object' &&
    !Array.isArray(record.interface)
    ? (record.interface as Record<string, unknown>)
    : null
}

function codexAuthorRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  return record.author && typeof record.author === 'object' && !Array.isArray(record.author)
    ? (record.author as Record<string, unknown>)
    : null
}

function toCodexPluginDescriptor(input: {
  manifestPath: string
  sourcePath: string
  marketplaceName: string
  marketplacePath: string
  pluginName: string
  record: Record<string, unknown>
}): ProviderPluginDescriptor {
  const iface = codexInterfaceRecord(input.record)
  const author = codexAuthorRecord(input.record)
  const displayName = trimString(iface?.displayName)
  const shortDescription =
    trimString(iface?.shortDescription) ?? trimString(input.record.description)
  const developerName = trimString(iface?.developerName) ?? trimString(author?.name)
  const homepage = trimString(iface?.websiteURL) ?? trimString(input.record.homepage)
  const name = trimString(iface?.displayName) ?? trimString(input.record.name) ?? input.pluginName

  return {
    id: trimString(input.record.name) ?? input.pluginName,
    provider: 'codex',
    marketplaceName: input.marketplaceName,
    marketplacePath: input.marketplacePath,
    name,
    ...compactOptionalFields({
      displayName: displayName && displayName !== name ? displayName : undefined,
      shortDescription,
      longDescription: trimString(iface?.longDescription),
      developerName,
      category: trimString(iface?.category),
      homepage,
    }),
    sourcePath: input.sourcePath,
    installed: true,
    enabled: true,
    ...compactOptionalFields({
      defaultPrompt: Array.isArray(iface?.defaultPrompt)
        ? readStringArray(iface.defaultPrompt)
        : undefined,
    }),
    tags: readStringArray(input.record.keywords),
  }
}

async function collectCodexPluginsFromMarketplace(input: {
  root: string
  marketplaceName: string
}): Promise<ProviderListPluginsResult> {
  const marketplacePath = path.join(input.root, input.marketplaceName)
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []
  const pluginEntries = await safeReadDir(marketplacePath)

  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue
    const pluginName = pluginEntry.name
    const pluginDir = path.join(marketplacePath, pluginName)
    const hashEntries = await safeReadDir(pluginDir)
    for (const hashEntry of hashEntries) {
      if (!hashEntry.isDirectory()) continue
      const sourcePath = path.join(pluginDir, hashEntry.name)
      const manifestPath = path.join(sourcePath, '.codex-plugin', 'plugin.json')
      const manifest = await safeReadJson(manifestPath)
      if (!manifest.ok) {
        warnings.push({
          path: manifestPath,
          message: `Failed to read Codex plugin manifest: ${manifest.error}`,
        })
        continue
      }
      const record =
        manifest.value && typeof manifest.value === 'object' && !Array.isArray(manifest.value)
          ? (manifest.value as Record<string, unknown>)
          : null
      if (!record) {
        warnings.push({
          path: manifestPath,
          message: 'Codex plugin manifest did not decode to an object.',
        })
        continue
      }
      plugins.push(
        toCodexPluginDescriptor({
          manifestPath,
          sourcePath,
          marketplaceName: input.marketplaceName,
          marketplacePath,
          pluginName,
          record,
        })
      )
    }
  }

  return { plugins, warnings, updatedAt: nowIso() }
}

function codexPluginCacheRoot(): string {
  return path.join(homedir(), '.codex', 'plugins', 'cache')
}

export async function listCodexPlugins(): Promise<ProviderListPluginsResult> {
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []
  const root = codexPluginCacheRoot()
  const marketplaces = await safeReadDir(root)

  for (const marketplaceEntry of marketplaces) {
    if (!marketplaceEntry.isDirectory()) continue
    const result = await collectCodexPluginsFromMarketplace({
      root,
      marketplaceName: marketplaceEntry.name,
    })
    warnings.push(...result.warnings)
    plugins.push(...result.plugins)
  }

  return finalizePluginResult({ plugins, warnings })
}

function claudePluginMarketplaceRoot(): string {
  return path.join(homedir(), '.claude', 'plugins', 'marketplaces')
}

function claudePluginCacheRoot(): string {
  return path.join(homedir(), '.claude', 'plugins', 'cache')
}

function claudePluginDataRoot(): string {
  return path.join(homedir(), '.claude', 'plugins', 'data')
}

function normalizeClaudeSourcePath(marketplacePath: string, source: unknown): string | undefined {
  if (typeof source === 'string') {
    return path.isAbsolute(source) ? source : path.join(marketplacePath, source)
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return undefined
  }
  const record = source as Record<string, unknown>
  return (
    trimString(record.url) ??
    trimString(record.path) ??
    trimString(record.source) ??
    trimString(record.ref)
  )
}

async function isClaudePluginInstalled(
  marketplaceName: string,
  pluginName: string
): Promise<boolean> {
  const candidates = [
    path.join(claudePluginCacheRoot(), marketplaceName, pluginName),
    path.join(claudePluginCacheRoot(), pluginName),
    path.join(claudePluginDataRoot(), `${pluginName}-${marketplaceName}`),
    path.join(claudePluginDataRoot(), pluginName),
  ]
  for (const candidate of candidates) {
    if (await safeExists(candidate)) {
      return true
    }
  }
  return false
}

function toClaudePluginDescriptor(input: {
  manifestPath: string
  marketplaceName: string
  marketplacePath: string
  owner: Record<string, unknown> | null
  plugin: Record<string, unknown>
  installed: boolean
}): ProviderPluginDescriptor | null {
  const name = trimString(input.plugin.name)
  if (!name) {
    return null
  }
  const author =
    input.plugin.author &&
    typeof input.plugin.author === 'object' &&
    !Array.isArray(input.plugin.author)
      ? (input.plugin.author as Record<string, unknown>)
      : null

  return {
    id: `${input.marketplaceName}:${name}`,
    provider: 'claudeAgent',
    marketplaceName: input.marketplaceName,
    marketplacePath: input.marketplacePath,
    name,
    ...(trimString(input.plugin.displayName)
      ? { displayName: trimString(input.plugin.displayName) }
      : {}),
    ...(trimString(input.plugin.description)
      ? { shortDescription: trimString(input.plugin.description) }
      : {}),
    ...(trimString(input.plugin.longDescription)
      ? { longDescription: trimString(input.plugin.longDescription) }
      : {}),
    ...((trimString(author?.name) ?? trimString(input.owner?.name))
      ? { developerName: trimString(author?.name) ?? trimString(input.owner?.name) }
      : {}),
    ...(trimString(input.plugin.category) ? { category: trimString(input.plugin.category) } : {}),
    ...(trimString(input.plugin.homepage) ? { homepage: trimString(input.plugin.homepage) } : {}),
    sourcePath:
      normalizeClaudeSourcePath(input.marketplacePath, input.plugin.source) ?? input.manifestPath,
    installed: input.installed,
    enabled: input.installed,
    tags: readStringArray(input.plugin.tags),
  }
}

async function collectClaudeMarketplacePlugins(input: {
  marketplacesRoot: string
  marketplaceEntry: Dirent
}): Promise<ProviderListPluginsResult> {
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []
  const marketplacePath = path.join(input.marketplacesRoot, input.marketplaceEntry.name)
  const manifestPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json')
  const manifest = await readObjectManifest({
    manifestPath,
    readErrorMessage: error => `Failed to read Claude marketplace manifest: ${error}`,
    invalidMessage: 'Claude marketplace manifest did not decode to an object.',
  })
  if (!manifest.ok) {
    return manifest.result
  }
  const record = manifest.record

  const marketplaceName = trimString(record.name) ?? input.marketplaceEntry.name
  const owner =
    record.owner && typeof record.owner === 'object' && !Array.isArray(record.owner)
      ? (record.owner as Record<string, unknown>)
      : null
  for (const pluginEntry of Array.isArray(record.plugins) ? record.plugins : []) {
    if (!pluginEntry || typeof pluginEntry !== 'object' || Array.isArray(pluginEntry)) {
      continue
    }
    const plugin = pluginEntry as Record<string, unknown>
    const name = trimString(plugin.name)
    if (!name) continue
    const descriptor = toClaudePluginDescriptor({
      manifestPath,
      marketplaceName,
      marketplacePath,
      owner,
      plugin,
      installed: await isClaudePluginInstalled(marketplaceName, name),
    })
    if (descriptor) {
      plugins.push(descriptor)
    }
  }

  return { plugins, warnings, updatedAt: nowIso() }
}

export async function listClaudePlugins(): Promise<ProviderListPluginsResult> {
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []
  const marketplacesRoot = claudePluginMarketplaceRoot()
  const marketplaceEntries = await safeReadDir(marketplacesRoot)

  for (const marketplaceEntry of marketplaceEntries) {
    if (!marketplaceEntry.isDirectory()) continue
    const result = await collectClaudeMarketplacePlugins({
      marketplacesRoot,
      marketplaceEntry,
    })
    warnings.push(...result.warnings)
    plugins.push(...result.plugins)
  }

  return finalizePluginResult({ plugins, warnings })
}
