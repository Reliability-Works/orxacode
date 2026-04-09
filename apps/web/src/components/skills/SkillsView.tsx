import type { ProviderKind, Skill } from '@orxa-code/contracts'
import { useQuery } from '@tanstack/react-query'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { useUiStateStore } from '../../uiStateStore'
import { isElectron } from '../../env'
import { getWsRpcClient } from '../../wsRpcClient'
import { skillsListQueryOptions } from '../../lib/skillsReactQuery'
import { SidebarInset } from '../ui/sidebar'
import { useSidebar } from '../ui/sidebar.shared'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { cn } from '~/lib/utils'
import { SkillCard } from './SkillCard'

type ProviderFilter = 'all' | ProviderKind

const PROVIDER_TABS: Array<{ key: ProviderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'codex', label: 'Codex' },
  { key: 'claudeAgent', label: 'Claude' },
  { key: 'opencode', label: 'OpenCode' },
]

function filterSkills(
  skills: ReadonlyArray<Skill>,
  provider: ProviderFilter,
  search: string
): ReadonlyArray<Skill> {
  let result = provider === 'all' ? skills : skills.filter(s => s.provider === provider)
  if (search.trim().length > 0) {
    const lower = search.toLowerCase()
    result = result.filter(
      s =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some(t => t.toLowerCase().includes(lower))
    )
  }
  return result
}

function SkillsHeader({
  collapsed,
  onRefresh,
  refreshing,
}: {
  collapsed: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center border-b border-border px-5',
        isElectron && 'drag-region',
        collapsed && 'ps-[var(--sidebar-width)]'
      )}
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Skills</span>
      <div className="ms-auto">
        <Button
          size="xs"
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh skills"
        >
          <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </div>
  )
}

function SkillsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  )
}

function ProviderTabs({
  selected,
  onChange,
}: {
  selected: ProviderFilter
  onChange: (v: ProviderFilter) => void
}) {
  return (
    <div className="flex gap-1">
      {PROVIDER_TABS.map(tab => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            selected === tab.key
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
  const threadLastVisitedAtById = useUiStateStore(s => s.threadLastVisitedAtById)
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

export function SkillsView(): ReactNode {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const [provider, setProvider] = useState<ProviderFilter>('all')
  const [search, setSearch] = useState('')
  const activeThreadId = useActiveThreadId()

  const skillsQuery = useQuery(skillsListQueryOptions())
  const refreshing = skillsQuery.isFetching

  const onRefresh = () => {
    void getWsRpcClient().skills.refresh({})
    void skillsQuery.refetch()
  }

  const displayedSkills = useMemo(
    () => filterSkills(skillsQuery.data?.skills ?? [], provider, search),
    [skillsQuery.data?.skills, provider, search]
  )

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <SkillsHeader collapsed={collapsed} onRefresh={onRefresh} refreshing={refreshing} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <ProviderTabs selected={provider} onChange={setProvider} />
              <div className="relative sm:ms-auto sm:w-56">
                <SearchIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  size="sm"
                  placeholder="Search skills…"
                  value={search}
                  onChange={e => setSearch((e.target as HTMLInputElement).value)}
                  className="ps-8"
                />
              </div>
            </div>

            {skillsQuery.isPending ? (
              <SkillsSkeleton />
            ) : skillsQuery.isError ? (
              <div className="flex items-center justify-center p-10">
                <p className="text-sm text-muted-foreground">Failed to load skills.</p>
              </div>
            ) : displayedSkills.length === 0 ? (
              <div className="flex items-center justify-center p-10">
                <p className="text-sm text-muted-foreground">
                  {search.length > 0 ? 'No skills match your search.' : 'No skills found.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {displayedSkills.map(skill => (
                  <SkillCard key={skill.id} skill={skill} activeThreadId={activeThreadId} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}
