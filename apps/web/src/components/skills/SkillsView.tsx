import type { ProviderPluginDescriptor, Skill } from '@orxa-code/contracts'
import { useQuery } from '@tanstack/react-query'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { isElectron } from '../../env'
import { providerPluginsQueryOptions } from '../../lib/providerDiscoveryReactQuery'
import { skillsListQueryOptions } from '../../lib/skillsReactQuery'
import { useUiStateStore } from '../../uiStateStore'
import { getWsRpcClient } from '../../wsRpcClient'
import { cn } from '~/lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SidebarInset } from '../ui/sidebar'
import { useSidebar } from '../ui/sidebar.shared'
import { Skeleton } from '../ui/skeleton'
import { PluginCard } from './PluginCard'
import { SkillCard } from './SkillCard'
import {
  type DiscoveryViewMode,
  filterPlugins,
  filterSkills,
  getPluginDiscoveryKey,
  getSkillDiscoveryKey,
  type ProviderFilter,
  PROVIDER_TABS,
} from './SkillsView.logic'

function SkillsHeader(props: { collapsed: boolean; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center border-b border-border px-5',
        isElectron && 'drag-region',
        props.collapsed && 'ps-[var(--sidebar-width)]'
      )}
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Discovery</span>
      <div className="ms-auto">
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          aria-label="Refresh discovery"
        >
          <RefreshCwIcon className={cn('size-3.5', props.refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </div>
  )
}

const DISCOVERY_COPY: Record<DiscoveryViewMode, { title: string; searchPlaceholder: string }> = {
  skills: { title: 'Skills', searchPlaceholder: 'Search skills…' },
  plugins: { title: 'Plugins', searchPlaceholder: 'Search plugins…' },
}

function SkillsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-32 rounded-xl" />
      ))}
    </div>
  )
}

function ToggleTabs<T extends string>(props: {
  tabs: ReadonlyArray<{ key: T; label: string }>
  selected: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex gap-1">
      {props.tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          onClick={() => props.onChange(tab.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            props.selected === tab.key
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function useActiveThreadId(): string | null {
  const threadLastVisitedAtById = useUiStateStore(state => state.threadLastVisitedAtById)
  return useMemo(() => {
    const entries = Object.entries(threadLastVisitedAtById)
    if (entries.length === 0) return null
    let bestId: string | null = null
    let bestAt = ''
    for (const [id, at] of entries) {
      if (at > bestAt) {
        bestAt = at
        bestId = id
      }
    }
    return bestId
  }, [threadLastVisitedAtById])
}

function useDiscoveryViewData(provider: ProviderFilter, search: string) {
  const skillsQuery = useQuery(skillsListQueryOptions())
  const codexPluginsQuery = useQuery(providerPluginsQueryOptions('codex'))
  const claudePluginsQuery = useQuery(providerPluginsQueryOptions('claudeAgent'))
  const opencodePluginsQuery = useQuery(providerPluginsQueryOptions('opencode'))
  const displayedSkills = useMemo(
    () => filterSkills(skillsQuery.data?.skills ?? [], provider, search),
    [provider, search, skillsQuery.data?.skills]
  )
  const displayedPlugins = useMemo(
    () =>
      filterPlugins(
        [
          ...(codexPluginsQuery.data?.plugins ?? []),
          ...(claudePluginsQuery.data?.plugins ?? []),
          ...(opencodePluginsQuery.data?.plugins ?? []),
        ],
        provider,
        search
      ),
    [
      claudePluginsQuery.data?.plugins,
      codexPluginsQuery.data?.plugins,
      opencodePluginsQuery.data?.plugins,
      provider,
      search,
    ]
  )

  return {
    skillsPending: skillsQuery.isPending,
    skillsError: skillsQuery.isError,
    pluginsPending:
      codexPluginsQuery.isPending || claudePluginsQuery.isPending || opencodePluginsQuery.isPending,
    pluginsError:
      codexPluginsQuery.isError || claudePluginsQuery.isError || opencodePluginsQuery.isError,
    refreshing: skillsQuery.isFetching,
    displayedSkills,
    displayedPlugins,
    onRefresh: () => {
      void getWsRpcClient().skills.refresh({})
      void skillsQuery.refetch()
      void codexPluginsQuery.refetch()
      void claudePluginsQuery.refetch()
      void opencodePluginsQuery.refetch()
    },
  }
}

function DiscoveryResults(props: {
  mode: DiscoveryViewMode
  search: string
  activeThreadId: string | null
  displayedSkills: ReadonlyArray<Skill>
  displayedPlugins: ReadonlyArray<ProviderPluginDescriptor>
  skillsPending: boolean
  skillsError: boolean
  pluginsPending: boolean
  pluginsError: boolean
}) {
  if (props.mode === 'skills') {
    if (props.skillsPending) return <SkillsSkeleton />
    if (props.skillsError) return <EmptyState label="Failed to load skills." />
    if (props.displayedSkills.length === 0) {
      return (
        <EmptyState
          label={props.search.length > 0 ? 'No skills match your search.' : 'No skills found.'}
        />
      )
    }
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {props.displayedSkills.map(skill => (
          <SkillCard
            key={getSkillDiscoveryKey(skill)}
            skill={skill}
            activeThreadId={props.activeThreadId}
          />
        ))}
      </div>
    )
  }
  if (props.pluginsPending) return <SkillsSkeleton />
  if (props.pluginsError) return <EmptyState label="Failed to load plugins." />
  if (props.displayedPlugins.length === 0) {
    return (
      <EmptyState
        label={props.search.length > 0 ? 'No plugins match your search.' : 'No plugins found.'}
      />
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {props.displayedPlugins.map(plugin => (
        <PluginCard key={getPluginDiscoveryKey(plugin)} plugin={plugin} />
      ))}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-10">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function ProviderDiscoveryView({ mode }: { mode: DiscoveryViewMode }): ReactNode {
  const { state } = useSidebar()
  const [provider, setProvider] = useState<ProviderFilter>('all')
  const [search, setSearch] = useState('')
  const activeThreadId = useActiveThreadId()
  const discovery = useDiscoveryViewData(provider, search)
  const copy = DISCOVERY_COPY[mode]

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <SkillsHeader
          collapsed={state === 'collapsed'}
          onRefresh={discovery.onRefresh}
          refreshing={discovery.refreshing}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-5">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">{copy.title}</h1>
              <p className="text-sm text-muted-foreground">
                Browse {copy.title.toLowerCase()} by provider.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <ToggleTabs tabs={PROVIDER_TABS} selected={provider} onChange={setProvider} />
              <div className="relative sm:ms-auto sm:w-56">
                <SearchIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  size="sm"
                  placeholder={copy.searchPlaceholder}
                  value={search}
                  onChange={event => setSearch((event.target as HTMLInputElement).value)}
                  className="ps-8"
                />
              </div>
            </div>
            <DiscoveryResults
              mode={mode}
              search={search}
              activeThreadId={activeThreadId}
              displayedSkills={discovery.displayedSkills}
              displayedPlugins={discovery.displayedPlugins}
              skillsPending={discovery.skillsPending}
              skillsError={discovery.skillsError}
              pluginsPending={discovery.pluginsPending}
              pluginsError={discovery.pluginsError}
            />
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}

export function SkillsView(): ReactNode {
  return <ProviderDiscoveryView mode="skills" />
}

export function PluginsView(): ReactNode {
  return <ProviderDiscoveryView mode="plugins" />
}
