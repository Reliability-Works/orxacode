import type { ProviderPluginDescriptor, Skill } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import {
  filterPlugins,
  filterSkills,
  getPluginDiscoveryKey,
  getSkillDiscoveryKey,
} from './SkillsView.logic'

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: 'shared-skill',
    name: 'Shared Skill',
    description: 'Useful description',
    provider: 'codex',
    source: 'filesystem',
    path: '/tmp/shared/SKILL.md',
    tags: ['utility'],
    updatedAt: '2026-04-09T12:00:00.000Z',
    ...overrides,
  }
}

function makePlugin(overrides: Partial<ProviderPluginDescriptor>): ProviderPluginDescriptor {
  return {
    id: 'shared-plugin',
    provider: 'codex',
    marketplaceName: 'Marketplace',
    marketplacePath: '/tmp/marketplace',
    name: 'shared-plugin',
    sourcePath: '/tmp/marketplace/shared-plugin',
    installed: true,
    enabled: true,
    tags: ['tooling'],
    ...overrides,
  }
}

describe('filterSkills', () => {
  it('filters by provider', () => {
    const skills = [
      makeSkill({ provider: 'codex', name: 'Codex Skill' }),
      makeSkill({ provider: 'claudeAgent', id: 'claude-skill', name: 'Claude Skill' }),
      makeSkill({ provider: 'opencode', id: 'opencode-skill', name: 'OpenCode Skill' }),
    ]

    expect(filterSkills(skills, 'claudeAgent', '')).toEqual([skills[1]])
  })

  it('filters by search across name, description, and tags', () => {
    const skills = [
      makeSkill({ id: 'alpha', name: 'Alpha', description: 'First tool', tags: ['planner'] }),
      makeSkill({ id: 'beta', name: 'Beta', description: 'Second tool', tags: ['executor'] }),
    ]

    expect(filterSkills(skills, 'all', 'plan')).toEqual([skills[0]])
    expect(filterSkills(skills, 'all', 'second')).toEqual([skills[1]])
    expect(filterSkills(skills, 'all', 'executor')).toEqual([skills[1]])
  })
})

describe('filterPlugins', () => {
  it('filters by provider', () => {
    const plugins = [
      makePlugin({ provider: 'codex', name: 'codex-plugin' }),
      makePlugin({ provider: 'claudeAgent', id: 'claude-plugin', name: 'claude-plugin' }),
      makePlugin({ provider: 'opencode', id: 'opencode-plugin', name: 'opencode-plugin' }),
    ]

    expect(filterPlugins(plugins, 'opencode', '')).toEqual([plugins[2]])
  })

  it('filters by search across display fields and tags', () => {
    const plugins = [
      makePlugin({ id: 'alpha', displayName: 'Alpha Helper', tags: ['filesystem'] }),
      makePlugin({ id: 'beta', shortDescription: 'Syncs memory', tags: ['memory'] }),
    ]

    expect(filterPlugins(plugins, 'all', 'alpha')).toEqual([plugins[0]])
    expect(filterPlugins(plugins, 'all', 'syncs')).toEqual([plugins[1]])
    expect(filterPlugins(plugins, 'all', 'memory')).toEqual([plugins[1]])
  })
})

describe('provider-qualified discovery keys', () => {
  it('keeps duplicate ids distinct across providers', () => {
    const codexSkill = makeSkill({ provider: 'codex', id: 'shared' })
    const claudeSkill = makeSkill({ provider: 'claudeAgent', id: 'shared' })
    const codexPlugin = makePlugin({ provider: 'codex', id: 'shared' })
    const opencodePlugin = makePlugin({ provider: 'opencode', id: 'shared' })

    expect(getSkillDiscoveryKey(codexSkill)).not.toBe(getSkillDiscoveryKey(claudeSkill))
    expect(getPluginDiscoveryKey(codexPlugin)).not.toBe(getPluginDiscoveryKey(opencodePlugin))
  })
})
