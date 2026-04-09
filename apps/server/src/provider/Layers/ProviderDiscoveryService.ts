import type {
  ProviderComposerCapabilities,
  ProviderKind,
  ProviderListCommandsResult,
  ProviderNativeCommandDescriptor,
} from '@orxa-code/contracts'
import { Effect, Layer } from 'effect'

import { ProviderDiscoveryService, type ProviderDiscoveryServiceShape } from '../Services/ProviderDiscoveryService.ts'
import { listClaudePlugins, listCodexPlugins } from './ProviderDiscoveryService.fs.ts'
import { listOpencodePlugins } from './ProviderDiscoveryService.opencode.ts'

const ALL_PROVIDERS = ['codex', 'claudeAgent', 'opencode'] as const satisfies ReadonlyArray<ProviderKind>

const CLAUDE_NATIVE_COMMANDS: ReadonlyArray<ProviderNativeCommandDescriptor> = [
  { name: 'clear', description: 'Clear the current Claude conversation context' },
  { name: 'compact', description: 'Compact the current Claude conversation context' },
  { name: 'config', description: 'Open Claude configuration controls' },
  { name: 'doctor', description: 'Run Claude environment diagnostics' },
  { name: 'help', description: 'Show Claude slash command help' },
  { name: 'mcp', description: 'Inspect or manage Claude MCP integrations' },
  { name: 'memory', description: 'Inspect Claude memory state' },
  { name: 'status', description: 'Show Claude runtime and account status' },
  { name: 'terminal-setup', description: 'Configure Claude terminal integration' },
]

const COMPOSER_CAPABILITIES_BY_PROVIDER: Record<ProviderKind, ProviderComposerCapabilities> = {
  codex: {
    provider: 'codex',
    supportsSkillMentions: true,
    supportsSkillDiscovery: true,
    supportsNativeSlashCommandDiscovery: false,
    supportsPluginDiscovery: true,
  },
  claudeAgent: {
    provider: 'claudeAgent',
    supportsSkillMentions: true,
    supportsSkillDiscovery: true,
    supportsNativeSlashCommandDiscovery: true,
    supportsPluginDiscovery: true,
  },
  opencode: {
    provider: 'opencode',
    supportsSkillMentions: true,
    supportsSkillDiscovery: true,
    supportsNativeSlashCommandDiscovery: false,
    supportsPluginDiscovery: true,
  },
}

function parseProviderInput(input: unknown): ProviderKind | null {
  if (
    input &&
    typeof input === 'object' &&
    'provider' in input &&
    typeof input.provider === 'string' &&
    ALL_PROVIDERS.includes(input.provider as ProviderKind)
  ) {
    return input.provider as ProviderKind
  }
  return null
}

function nowIso(): string {
  return new Date().toISOString()
}

const make = Effect.succeed({
  getComposerCapabilities: (input => {
    const provider = parseProviderInput(input)
    return Effect.succeed(COMPOSER_CAPABILITIES_BY_PROVIDER[provider ?? 'codex'])
  }) satisfies ProviderDiscoveryServiceShape['getComposerCapabilities'],
  listCommands: (input => {
    const provider = parseProviderInput(input)
    return Effect.succeed({
      commands:
        provider === 'claudeAgent' &&
        COMPOSER_CAPABILITIES_BY_PROVIDER.claudeAgent.supportsNativeSlashCommandDiscovery
          ? [...CLAUDE_NATIVE_COMMANDS]
          : [],
      updatedAt: nowIso(),
    } satisfies ProviderListCommandsResult)
  }) satisfies ProviderDiscoveryServiceShape['listCommands'],
  listPlugins: (input => {
    const provider = parseProviderInput(input)
    if (provider === 'codex') {
      return Effect.promise(() => listCodexPlugins())
    }
    if (provider === 'claudeAgent') {
      return Effect.promise(() => listClaudePlugins())
    }
    if (provider === 'opencode') {
      return Effect.promise(() => listOpencodePlugins())
    }
    return Effect.succeed({
      plugins: [],
      warnings:
        provider === null
          ? [
              {
                path: 'provider',
                message: 'Expected provider discovery input to include a supported provider.',
              },
            ]
          : [],
      updatedAt: nowIso(),
    })
  }) satisfies ProviderDiscoveryServiceShape['listPlugins'],
})

export const ProviderDiscoveryServiceLive = Layer.effect(ProviderDiscoveryService, make)
