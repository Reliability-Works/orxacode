import { useCallback, useRef, useState } from 'react'
import type { ProjectBootstrap, ProjectListItem, SessionMessageBundle } from '@shared/ipc'
import {
  buildDaySeries,
  refreshDashboard as refreshDashboardImpl,
  refreshProjectDashboard as refreshProjectDashboardImpl,
  summarizeMessagesTelemetry,
  type SessionTelemetrySummary,
} from './useDashboards-refreshers'

export type Project = ProjectListItem
export type ProjectData = ProjectBootstrap

export type HomeDashboardState = {
  loading: boolean
  updatedAt?: number
  error?: string
  recentSessions: Array<{
    id: string
    title: string
    project: string
    updatedAt: number
  }>
  sessions7d: number
  sessions30d: number
  projects: number
  providersConnected: number
  topModels: Array<{
    model: string
    count: number
  }>
  tokenInput30d: number
  tokenOutput30d: number
  tokenCacheRead30d: number
  totalCost30d: number
  daySeries: Array<{
    label: string
    count: number
  }>
}

export type ProjectDashboardState = {
  loading: boolean
  updatedAt?: number
  error?: string
  sessions7d: number
  sessions30d: number
  sessionCount: number
  tokenInput30d: number
  tokenOutput30d: number
  tokenCacheRead30d: number
  totalCost30d: number
  topModels: Array<{
    model: string
    count: number
  }>
  daySeries: Array<{
    label: string
    count: number
  }>
  recentSessions: Array<{
    id: string
    title: string
    updatedAt: number
    status: string
  }>
}

const TELEMETRY_CACHE_TTL_MS = 2 * 60 * 1000

export function useDashboards(
  projects: Project[],
  activeProjectDir: string | null,
  projectData: ProjectData | null
) {
  const [dashboard, setDashboard] = useState<HomeDashboardState>({
    loading: false,
    recentSessions: [],
    sessions7d: 0,
    sessions30d: 0,
    projects: 0,
    providersConnected: 0,
    topModels: [],
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
    daySeries: buildDaySeries([]),
  })

  const [projectDashboard, setProjectDashboard] = useState<ProjectDashboardState>({
    loading: false,
    sessions7d: 0,
    sessions30d: 0,
    sessionCount: 0,
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
    topModels: [],
    daySeries: buildDaySeries([]),
    recentSessions: [],
  })

  const projectDashboardCacheRef = useRef<Record<string, ProjectDashboardState>>({})
  const sessionTelemetryCacheRef = useRef<
    Record<
      string,
      {
        sessionUpdatedAt: number
        cachedAt: number
        summary: SessionTelemetrySummary
      }
    >
  >({})

  const loadSessionTelemetry = useCallback(
    async (directory: string, sessionID: string, updatedAt: number) => {
      const cacheKey = `${directory}:${sessionID}`
      const cached = sessionTelemetryCacheRef.current[cacheKey]
      const isFresh =
        cached &&
        cached.sessionUpdatedAt === updatedAt &&
        Date.now() - cached.cachedAt <= TELEMETRY_CACHE_TTL_MS
      if (isFresh && cached) {
        return cached.summary
      }
      const payload = await window.orxa.opencode.loadMessages(directory, sessionID).catch(() => [])
      const summary = summarizeMessagesTelemetry(payload as SessionMessageBundle[], updatedAt)
      sessionTelemetryCacheRef.current[cacheKey] = {
        sessionUpdatedAt: updatedAt,
        cachedAt: Date.now(),
        summary,
      }
      return summary
    },
    []
  )

  const refreshDashboard = useCallback(
    () =>
      refreshDashboardImpl({
        projects,
        setDashboard,
        loadSessionTelemetry,
      }),
    [loadSessionTelemetry, projects]
  )

  const refreshProjectDashboard = useCallback(
    () =>
      refreshProjectDashboardImpl({
        activeProjectDir,
        projectData,
        setProjectDashboard,
        loadSessionTelemetry,
        projectDashboardCacheRef,
      }),
    [activeProjectDir, loadSessionTelemetry, projectData]
  )

  return {
    dashboard,
    projectDashboard,
    refreshDashboard,
    refreshProjectDashboard,
  }
}
