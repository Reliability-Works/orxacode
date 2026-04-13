import type { ModelUsage, ProviderKind, ProviderUsageSnapshot } from '@orxa-code/contracts'
import type { UseQueryResult } from '@tanstack/react-query'

import { Skeleton } from '../ui/skeleton'
import { cn } from '~/lib/utils'

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: 'Codex',
  claudeAgent: 'Claude',
  opencode: 'OpenCode',
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

function formatCostCents(cents: number): string {
  if (cents === 0) return '$0.00'
  if (cents < 100) return `$0.${String(cents).padStart(2, '0')}`
  return `$${(cents / 100).toFixed(2)}`
}

interface StatLineProps {
  label: string
  value: string
  className?: string
}

function StatLine({ label, value, className }: StatLineProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular-nums text-xs font-medium">{value}</span>
    </div>
  )
}

function TopModelRow({ usage }: { usage: ModelUsage }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
        {usage.model}
      </span>
      <span className="tabular-nums text-caption">{usage.count}</span>
    </div>
  )
}

interface ProviderPanelBodyProps {
  snapshot: ProviderUsageSnapshot
}

function ProviderPanelBody({ snapshot }: ProviderPanelBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <StatLine label="Sessions (7d)" value={`${snapshot.sessions7d}`} />
        <StatLine label="Sessions (30d)" value={`${snapshot.sessions30d}`} />
        <StatLine label="Tokens in" value={formatTokens(snapshot.tokensIn)} />
        <StatLine label="Tokens out" value={formatTokens(snapshot.tokensOut)} />
        <StatLine label="Cache read" value={formatTokens(snapshot.tokensCacheRead)} />
        <StatLine label="Est. cost" value={formatCostCents(snapshot.estimatedCostCents)} />
      </div>
      {snapshot.topModels.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-mini font-medium uppercase tracking-wider text-muted-foreground/60">
            Top models
          </span>
          {snapshot.topModels.map(usage => (
            <TopModelRow key={usage.model} usage={usage} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface DashboardProviderPanelProps {
  provider: ProviderKind
  query: UseQueryResult<ProviderUsageSnapshot>
}

export function DashboardProviderPanel({ provider, query }: DashboardProviderPanelProps) {
  const label = PROVIDER_LABELS[provider]

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <span className="text-xs font-semibold">{label}</span>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : query.isError ? (
        <p className="text-xs text-muted-foreground/60">Usage data unavailable.</p>
      ) : (
        <ProviderPanelBody snapshot={query.data} />
      )}
    </div>
  )
}
