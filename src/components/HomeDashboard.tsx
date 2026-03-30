import { useEffect, useState } from 'react'
import type { ProviderUsageStats } from '@shared/ipc'
import {
  DashboardChartsSection,
  DashboardLatestSessionsSection,
  DashboardOverviewSection,
  DashboardTabs,
  DashboardUsagePanel,
} from './home-dashboard-panels'

type ProviderTab = 'opencode' | 'codex' | 'claude'

type Props = {
  loading: boolean
  projects: number
  sessions7d: number
  sessions30d: number
  providersConnected: number
  topModels: { model: string; count: number }[]
  tokenInput30d: number
  tokenOutput30d: number
  tokenCacheRead30d: number
  totalCost30d: number
  recentSessions: { id: string; title: string; project: string; updatedAt: number }[]
  daySeries: { label: string; count: number }[]
  updatedAt?: number
  error?: string
  codexSessionCount?: number
  claudeSessionCount?: number
  codexUsage?: ProviderUsageStats | null
  claudeUsage?: ProviderUsageStats | null
  codexUsageLoading?: boolean
  claudeUsageLoading?: boolean
  onRefresh: () => void
  onAddWorkspace: () => void
  onOpenSettings: () => void
  onRefreshCodexUsage?: () => void
  onRefreshClaudeUsage?: () => void
}

export function HomeDashboard({
  loading,
  projects,
  sessions7d,
  sessions30d,
  providersConnected,
  topModels,
  tokenInput30d,
  tokenOutput30d,
  tokenCacheRead30d,
  totalCost30d,
  recentSessions,
  daySeries,
  updatedAt,
  error,
  codexSessionCount = 0,
  claudeSessionCount = 0,
  codexUsage,
  claudeUsage,
  codexUsageLoading = false,
  claudeUsageLoading = false,
  onRefresh,
  onAddWorkspace,
  onOpenSettings,
  onRefreshCodexUsage,
  onRefreshClaudeUsage,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProviderTab>('opencode')

  // Auto-refresh usage stats when switching to codex/claude tabs
  useEffect(() => {
    if (activeTab === 'codex' && !codexUsage && !codexUsageLoading && onRefreshCodexUsage) {
      onRefreshCodexUsage()
    }
    if (activeTab === 'claude' && !claudeUsage && !claudeUsageLoading && onRefreshClaudeUsage) {
      onRefreshClaudeUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <h1>orxa dashboard</h1>
        <p>// monitor workspaces and jump into sessions quickly.</p>
      </header>

      <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <DashboardLatestSessionsSection
        loading={loading}
        recentSessions={recentSessions}
        onRefresh={onRefresh}
        onAddWorkspace={onAddWorkspace}
        onOpenSettings={onOpenSettings}
      />

      {activeTab === 'opencode' ? (
        <>
          <DashboardOverviewSection
            projects={projects}
            sessions7d={sessions7d}
            sessions30d={sessions30d}
            providersConnected={providersConnected}
            topModels={topModels}
            tokenInput30d={tokenInput30d}
            tokenOutput30d={tokenOutput30d}
            tokenCacheRead30d={tokenCacheRead30d}
            totalCost30d={totalCost30d}
            updatedAt={updatedAt}
            error={error}
          />
          <DashboardChartsSection daySeries={daySeries} />
        </>
      ) : null}

      {activeTab === 'codex' ? (
        <DashboardUsagePanel
          title="codex usage snapshot"
          providerName="Codex"
          sessionCount={codexSessionCount}
          usage={codexUsage}
          loading={codexUsageLoading}
          onRefresh={onRefreshCodexUsage}
        />
      ) : null}

      {activeTab === 'claude' ? (
        <DashboardUsagePanel
          title="claude code usage snapshot"
          providerName="Claude"
          sessionCount={claudeSessionCount}
          usage={claudeUsage}
          loading={claudeUsageLoading}
          onRefresh={onRefreshClaudeUsage}
        />
      ) : null}
    </section>
  )
}
