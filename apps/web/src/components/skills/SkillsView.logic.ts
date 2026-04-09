import type { ProviderKind, ProviderPluginDescriptor, Skill } from '@orxa-code/contracts'

export type ProviderFilter = 'all' | ProviderKind
export type DiscoveryViewMode = 'skills' | 'plugins'

export const PROVIDER_TABS: Array<{ key: ProviderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'codex', label: 'Codex' },
  { key: 'claudeAgent', label: 'Claude' },
  { key: 'opencode', label: 'OpenCode' },
]

export function filterSkills(
  skills: ReadonlyArray<Skill>,
  provider: ProviderFilter,
  search: string
) {
  let result = provider === 'all' ? skills : skills.filter(skill => skill.provider === provider)
  if (search.trim().length > 0) {
    const lower = search.toLowerCase()
    result = result.filter(
      skill =>
        skill.name.toLowerCase().includes(lower) ||
        skill.description.toLowerCase().includes(lower) ||
        skill.tags.some(tag => tag.toLowerCase().includes(lower))
    )
  }
  return result
}

export function filterPlugins(
  plugins: ReadonlyArray<ProviderPluginDescriptor>,
  provider: ProviderFilter,
  search: string
) {
  let result = provider === 'all' ? plugins : plugins.filter(plugin => plugin.provider === provider)
  if (search.trim().length > 0) {
    const lower = search.toLowerCase()
    result = result.filter(
      plugin =>
        plugin.name.toLowerCase().includes(lower) ||
        (plugin.displayName?.toLowerCase().includes(lower) ?? false) ||
        (plugin.shortDescription?.toLowerCase().includes(lower) ?? false) ||
        (plugin.longDescription?.toLowerCase().includes(lower) ?? false) ||
        plugin.tags.some(tag => tag.toLowerCase().includes(lower))
    )
  }
  return result
}

export function getSkillDiscoveryKey(skill: Skill): string {
  return `${skill.provider}:${skill.id}`
}

export function getPluginDiscoveryKey(plugin: ProviderPluginDescriptor): string {
  return `${plugin.provider}:${plugin.id}`
}
