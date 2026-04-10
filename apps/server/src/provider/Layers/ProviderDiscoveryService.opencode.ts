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

function opencodeConfigRoot(): string {
  return path.join(homedir(), '.config', 'opencode')
}

function opencodeCacheRoot(): string {
  return path.join(homedir(), '.cache', 'opencode')
}

function opencodeAuthorName(record: Record<string, unknown>): string | undefined {
  if (typeof record.author === 'string') {
    return trimString(record.author)
  }
  if (record.author && typeof record.author === 'object' && !Array.isArray(record.author)) {
    return trimString((record.author as Record<string, unknown>).name)
  }
  return undefined
}

function isOpencodePluginPackage(record: Record<string, unknown>): boolean {
  const keywords = readStringArray(record.keywords).map(keyword => keyword.toLowerCase())
  const dependencies =
    record.dependencies &&
    typeof record.dependencies === 'object' &&
    !Array.isArray(record.dependencies)
      ? (record.dependencies as Record<string, unknown>)
      : {}
  const peerDependencies =
    record.peerDependencies &&
    typeof record.peerDependencies === 'object' &&
    !Array.isArray(record.peerDependencies)
      ? (record.peerDependencies as Record<string, unknown>)
      : {}
  const opencodeRecord =
    record.opencode && typeof record.opencode === 'object' && !Array.isArray(record.opencode)
      ? (record.opencode as Record<string, unknown>)
      : null

  if (trimString(opencodeRecord?.type) === 'plugin') {
    return true
  }
  if ('@opencode-ai/plugin' in dependencies || '@opencode-ai/plugin' in peerDependencies) {
    return true
  }
  if (keywords.includes('opencode-plugin')) {
    return true
  }
  return keywords.includes('opencode') && keywords.includes('plugin')
}

function toOpencodePluginDescriptor(input: {
  packageDir: string
  packageName: string
  marketplaceName: string
  marketplacePath: string
  record: Record<string, unknown>
}): ProviderPluginDescriptor {
  const displayName = trimString(input.record.displayName)
  const homepage =
    trimString(input.record.homepage) ??
    (input.record.repository &&
    typeof input.record.repository === 'object' &&
    !Array.isArray(input.record.repository)
      ? trimString((input.record.repository as Record<string, unknown>).url)
      : undefined)

  return {
    id: trimString(input.record.name) ?? input.packageName,
    provider: 'opencode',
    marketplaceName: input.marketplaceName,
    marketplacePath: input.marketplacePath,
    name: trimString(input.record.name) ?? input.packageName,
    ...compactOptionalFields({
      displayName,
      shortDescription: trimString(input.record.description),
      developerName: opencodeAuthorName(input.record),
      homepage,
    }),
    sourcePath: input.packageDir,
    installed: true,
    enabled: true,
    tags: readStringArray(input.record.keywords),
  }
}

async function collectOpencodePluginsFromRoot(input: {
  rootPath: string
  marketplaceName: string
}): Promise<ProviderListPluginsResult> {
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []
  const packageJsonPath = path.join(input.rootPath, 'package.json')
  const manifest = await readObjectManifest({
    manifestPath: packageJsonPath,
    readErrorMessage: error => `Failed to read Opencode package manifest: ${error}`,
    invalidMessage: 'Opencode package manifest did not decode to an object.',
  })
  if (!manifest.ok) {
    return manifest.result
  }
  const record = manifest.record

  const dependencyBlocks = [record.dependencies, record.devDependencies]
  const packageNames = new Set<string>()
  for (const block of dependencyBlocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    for (const packageName of Object.keys(block as Record<string, unknown>)) {
      packageNames.add(packageName)
    }
  }

  for (const packageName of packageNames) {
    const packageDir = path.join(input.rootPath, 'node_modules', packageName)
    const packageManifestPath = path.join(packageDir, 'package.json')
    const packageManifest = await safeReadJson(packageManifestPath)
    if (!packageManifest.ok) {
      continue
    }
    const packageRecord =
      packageManifest.value &&
      typeof packageManifest.value === 'object' &&
      !Array.isArray(packageManifest.value)
        ? (packageManifest.value as Record<string, unknown>)
        : null
    if (!packageRecord || !isOpencodePluginPackage(packageRecord)) {
      continue
    }
    plugins.push(
      toOpencodePluginDescriptor({
        packageDir,
        packageName,
        marketplaceName: input.marketplaceName,
        marketplacePath: input.rootPath,
        record: packageRecord,
      })
    )
  }

  return { plugins, warnings, updatedAt: nowIso() }
}

export async function listOpencodePlugins(): Promise<ProviderListPluginsResult> {
  const roots = [
    { rootPath: opencodeConfigRoot(), marketplaceName: 'Opencode config' },
    { rootPath: opencodeCacheRoot(), marketplaceName: 'Opencode cache' },
  ]
  const warnings: Array<ProviderListPluginsResult['warnings'][number]> = []
  const plugins: ProviderPluginDescriptor[] = []

  for (const root of roots) {
    const result = await collectOpencodePluginsFromRoot(root)
    warnings.push(...result.warnings)
    plugins.push(...result.plugins)
  }

  return finalizePluginResult({ plugins, warnings })
}
