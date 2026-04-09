import type { ProviderKind, Skill } from '@orxa-code/contracts'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  providerComposerCapabilitiesQueryOptions,
  providerNativeCommandsQueryOptions,
} from '~/lib/providerDiscoveryReactQuery'
import { skillsListQueryOptions } from '~/lib/skillsReactQuery'
import type { ComposerCommandItem } from './ComposerCommandMenu'

function buildSkillCommandItems(skills: readonly Skill[]): ReadonlyArray<Extract<ComposerCommandItem, { type: 'skill' }>> {
  return skills.map(skill => ({
    id: `skill:${skill.provider}:${skill.id}`,
    type: 'skill',
    skill,
    label: skill.name,
    description: skill.description,
  }))
}

export function useProviderDiscoveryMenuData(params: {
  provider: ProviderKind
  pathTriggerQuery: string
}) {
  const capabilitiesQuery = useQuery(providerComposerCapabilitiesQueryOptions(params.provider))
  const nativeCommandsQuery = useQuery(providerNativeCommandsQueryOptions(params.provider))
  const skillsQuery = useQuery(skillsListQueryOptions(params.provider))

  const filteredSkills = useMemo(() => {
    if (!(capabilitiesQuery.data?.supportsSkillDiscovery ?? true)) {
      return [] as Skill[]
    }
    const query = params.pathTriggerQuery.trim().toLowerCase()
    const skills = skillsQuery.data?.skills ?? []
    if (!query) {
      return skills.slice(0, 24)
    }
    return skills.filter(skill => {
      const name = skill.name.toLowerCase()
      const description = skill.description.toLowerCase()
      return (
        skill.id.toLowerCase().includes(query) ||
        name.includes(query) ||
        description.includes(query) ||
        skill.tags.some(tag => tag.toLowerCase().includes(query))
      )
    })
  }, [capabilitiesQuery.data?.supportsSkillDiscovery, params.pathTriggerQuery, skillsQuery.data?.skills])

  const nativeSlashCommandItems = useMemo<
    ReadonlyArray<Extract<ComposerCommandItem, { type: 'native-slash-command' }>>
  >(
    () =>
      (
        capabilitiesQuery.data?.supportsNativeSlashCommandDiscovery
          ? nativeCommandsQuery.data?.commands ?? []
          : []
      ).map(command => ({
        id: `native-slash:${params.provider}:${command.name}`,
        type: 'native-slash-command',
        provider: params.provider,
        command: command.name,
        label: `/${command.name}`,
        description: command.description ?? `${params.provider} native slash command`,
      })),
    [
      capabilitiesQuery.data?.supportsNativeSlashCommandDiscovery,
      nativeCommandsQuery.data?.commands,
      params.provider,
    ]
  )

  return {
    composerCapabilities: capabilitiesQuery.data ?? null,
    nativeCommandsQuery,
    skillsQuery,
    nativeSlashCommandItems,
    skillItems: buildSkillCommandItems(filteredSkills),
  }
}
