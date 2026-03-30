import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap, ProjectListItem, SessionMessageBundle } from '@shared/ipc'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { HomeDashboardState, ProjectDashboardState } from './useDashboards'

export type SessionTelemetrySummary = {
  tokenInput: number
  tokenOutput: number
  tokenCacheRead: number
  totalCost: number
  modelUsage: Map<string, number>
  tokenSeriesPoints: Array<{
    timestamp: number
    value: number
  }>
}

type LoadSessionTelemetry = (
  directory: string,
  sessionID: string,
  updatedAt: number
) => Promise<SessionTelemetrySummary>

type RefreshDashboardDeps = {
  projects: ProjectListItem[]
  setDashboard: Dispatch<SetStateAction<HomeDashboardState>>
  loadSessionTelemetry: LoadSessionTelemetry
}

type RefreshProjectDashboardDeps = {
  activeProjectDir: string | null
  projectData: ProjectBootstrap | null
  setProjectDashboard: Dispatch<SetStateAction<ProjectDashboardState>>
  loadSessionTelemetry: LoadSessionTelemetry
  projectDashboardCacheRef: MutableRefObject<Record<string, ProjectDashboardState>>
}

export function buildDaySeries(points: Array<{ timestamp: number; value: number }>) {
  const msPerDay = 24 * 60 * 60 * 1000
  const now = Date.now()
  const slots = Array.from({ length: 7 }, (_, reverseIndex) => {
    const index = 6 - reverseIndex
    const start = now - (index + 1) * msPerDay
    const end = start + msPerDay
    return {
      start,
      end,
      label: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count: 0,
    }
  })

  for (const point of points) {
    const slot = slots.find(item => point.timestamp >= item.start && point.timestamp < item.end)
    if (slot) {
      slot.count += point.value
    }
  }

  return slots.map(item => ({ label: item.label, count: item.count }))
}

function topModelsFromUsage(modelUsage: Map<string, number>) {
  const groupedModels = new Map<string, number>()
  for (const [model, count] of modelUsage.entries()) {
    const trimmed = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model
    groupedModels.set(trimmed, (groupedModels.get(trimmed) ?? 0) + count)
  }
  return [...groupedModels.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

function summarizeStepFinishParts(parts: Part[]) {
  let tokenInput = 0
  let tokenOutput = 0
  let tokenCacheRead = 0
  let cost = 0
  let totalTokens = 0

  for (const part of parts) {
    if (part.type !== 'step-finish') {
      continue
    }
    tokenInput += part.tokens.input ?? 0
    tokenOutput += part.tokens.output ?? 0
    tokenCacheRead += part.tokens.cache.read ?? 0
    totalTokens += (part.tokens.input ?? 0) + (part.tokens.output ?? 0)
    cost += part.cost ?? 0
  }

  return {
    tokenInput,
    tokenOutput,
    tokenCacheRead,
    totalTokens,
    cost,
  }
}

export function summarizeMessagesTelemetry(
  messages: SessionMessageBundle[],
  fallbackTimestamp: number
): SessionTelemetrySummary {
  const modelUsage = new Map<string, number>()
  const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = []
  let tokenInput = 0
  let tokenOutput = 0
  let tokenCacheRead = 0
  let totalCost = 0

  for (const message of messages) {
    const info = message.info as {
      role?: string
      providerID?: string
      modelID?: string
      time?: { created?: number }
    }
    if (info.role === 'assistant' && info.providerID && info.modelID) {
      const modelKey = `${info.providerID}/${info.modelID}`
      modelUsage.set(modelKey, (modelUsage.get(modelKey) ?? 0) + 1)
    }

    const summary = summarizeStepFinishParts(message.parts)
    tokenInput += summary.tokenInput
    tokenOutput += summary.tokenOutput
    tokenCacheRead += summary.tokenCacheRead
    totalCost += summary.cost
    if (summary.totalTokens > 0) {
      tokenSeriesPoints.push({
        timestamp: typeof info.time?.created === 'number' ? info.time.created : fallbackTimestamp,
        value: summary.totalTokens,
      })
    }
  }

  return {
    tokenInput,
    tokenOutput,
    tokenCacheRead,
    totalCost,
    modelUsage,
    tokenSeriesPoints,
  }
}

async function loadSummary(
  loadSessionTelemetry: LoadSessionTelemetry,
  candidate: { directory: string; sessionID: string; updatedAt: number }
) {
  return loadSessionTelemetry(candidate.directory, candidate.sessionID, candidate.updatedAt)
}

type ProjectSnapshot = { project: ProjectListItem; data: ProjectBootstrap | undefined }

type DashboardAggregateState = {
  sessionTimes: number[]
  tokenSeriesPoints: Array<{ timestamp: number; value: number }>
  recentSessions: HomeDashboardState['recentSessions']
  connectedProviders: Set<string>
  modelUsage: Map<string, number>
  telemetryCandidates: Array<{ directory: string; sessionID: string; updatedAt: number }>
  tokenInput30d: number
  tokenOutput30d: number
  tokenCacheRead30d: number
  totalCost30d: number
}

function createInitialAggregateState(): DashboardAggregateState {
  return {
    sessionTimes: [],
    tokenSeriesPoints: [],
    recentSessions: [],
    connectedProviders: new Set(),
    modelUsage: new Map(),
    telemetryCandidates: [],
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
  }
}

function aggregateSnapshots(
  snapshots: ProjectSnapshot[],
  thirtyDaysAgo: number
): DashboardAggregateState {
  const state = createInitialAggregateState()

  for (const snapshot of snapshots) {
    const data = snapshot.data
    if (!data) {
      continue
    }

    for (const provider of data.providers.connected) {
      state.connectedProviders.add(provider)
    }

    const modelHints = [data.config.model, data.config.small_model].filter(
      (item): item is string => Boolean(item)
    )
    for (const modelHint of modelHints) {
      state.modelUsage.set(modelHint, (state.modelUsage.get(modelHint) ?? 0) + 1)
    }

    for (const session of data.sessions) {
      state.sessionTimes.push(session.time.updated)
      if (session.time.updated >= thirtyDaysAgo) {
        state.telemetryCandidates.push({
          directory: data.directory,
          sessionID: session.id,
          updatedAt: session.time.updated,
        })
      }
      state.recentSessions.push({
        id: `${snapshot.project.id}:${session.id}`,
        title: session.title || session.slug,
        project:
          snapshot.project.name ||
          snapshot.project.worktree.split('/').at(-1) ||
          snapshot.project.worktree,
        updatedAt: session.time.updated,
      })
    }
  }

  return state
}

async function aggregateTelemetry(
  telemetryCandidates: Array<{ directory: string; sessionID: string; updatedAt: number }>,
  loadSessionTelemetry: LoadSessionTelemetry,
  modelUsage: Map<string, number>
): Promise<Pick<DashboardAggregateState, 'tokenInput30d' | 'tokenOutput30d' | 'tokenCacheRead30d' | 'totalCost30d'> & { tokenSeriesPoints: Array<{ timestamp: number; value: number }> }> {
  const recentTelemetrySessions = telemetryCandidates
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 24)

  let tokenInput30d = 0
  let tokenOutput30d = 0
  let tokenCacheRead30d = 0
  let totalCost30d = 0
  const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = []

  if (recentTelemetrySessions.length > 0) {
    for (let index = 0; index < recentTelemetrySessions.length; index += 6) {
      const batch = recentTelemetrySessions.slice(index, index + 6)
      const summaries = await Promise.all(
        batch.map(candidate => loadSummary(loadSessionTelemetry, candidate))
      )
      for (const summary of summaries) {
        tokenInput30d += summary.tokenInput
        tokenOutput30d += summary.tokenOutput
        tokenCacheRead30d += summary.tokenCacheRead
        totalCost30d += summary.totalCost
        for (const [modelKey, count] of summary.modelUsage.entries()) {
          modelUsage.set(modelKey, (modelUsage.get(modelKey) ?? 0) + count)
        }
        tokenSeriesPoints.push(...summary.tokenSeriesPoints)
      }
    }
  }

  return { tokenInput30d, tokenOutput30d, tokenCacheRead30d, totalCost30d, tokenSeriesPoints }
}

export async function refreshDashboard({
  projects,
  setDashboard,
  loadSessionTelemetry,
}: RefreshDashboardDeps) {
  setDashboard(current => ({
    ...current,
    loading: true,
    error: undefined,
    projects: projects.length,
  }))
  if (projects.length === 0) {
    setDashboard({
      loading: false,
      updatedAt: Date.now(),
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
    return
  }

  try {
    const snapshots = await Promise.all(
      projects.map(async project => {
        try {
          const data = await window.orxa.opencode.refreshProject(project.worktree)
          return { project, data }
        } catch {
          return { project, data: undefined }
        }
      })
    )

    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const aggregate = aggregateSnapshots(snapshots, thirtyDaysAgo)

    const telemetry = await aggregateTelemetry(
      aggregate.telemetryCandidates,
      loadSessionTelemetry,
      aggregate.modelUsage
    )

    aggregate.recentSessions.sort((a, b) => b.updatedAt - a.updatedAt)
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

    setDashboard({
      loading: false,
      updatedAt: now,
      recentSessions: aggregate.recentSessions,
      sessions7d: aggregate.sessionTimes.filter(time => time >= sevenDaysAgo).length,
      sessions30d: aggregate.sessionTimes.filter(time => time >= thirtyDaysAgo).length,
      projects: projects.length,
      providersConnected: aggregate.connectedProviders.size,
      topModels: topModelsFromUsage(aggregate.modelUsage),
      tokenInput30d: telemetry.tokenInput30d,
      tokenOutput30d: telemetry.tokenOutput30d,
      tokenCacheRead30d: telemetry.tokenCacheRead30d,
      totalCost30d: telemetry.totalCost30d,
      daySeries: buildDaySeries(telemetry.tokenSeriesPoints),
    })
  } catch (error) {
    setDashboard(current => ({
      ...current,
      loading: false,
      updatedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

type ProjectTelemetryAggregate = {
  tokenInput30d: number
  tokenOutput30d: number
  tokenCacheRead30d: number
  totalCost30d: number
  modelUsage: Map<string, number>
  tokenSeriesPoints: Array<{ timestamp: number; value: number }>
}

function createInitialProjectTelemetry(): ProjectTelemetryAggregate {
  return {
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
    modelUsage: new Map(),
    tokenSeriesPoints: [],
  }
}

type TelemetryCandidate = {
  id: string
  time: { updated: number }
}

async function aggregateProjectTelemetry(
  telemetryCandidates: TelemetryCandidate[],
  activeProjectDir: string,
  loadSessionTelemetry: LoadSessionTelemetry
): Promise<ProjectTelemetryAggregate> {
  const result = createInitialProjectTelemetry()

  for (let index = 0; index < telemetryCandidates.length; index += 6) {
    const batch = telemetryCandidates.slice(index, index + 6)
    const summaries = await Promise.all(
      batch.map((session: TelemetryCandidate) => loadSessionTelemetry(activeProjectDir, session.id, session.time.updated))
    )
    for (const summary of summaries) {
      result.tokenInput30d += summary.tokenInput
      result.tokenOutput30d += summary.tokenOutput
      result.tokenCacheRead30d += summary.tokenCacheRead
      result.totalCost30d += summary.totalCost
      for (const [key, count] of summary.modelUsage.entries()) {
        result.modelUsage.set(key, (result.modelUsage.get(key) ?? 0) + count)
      }
      result.tokenSeriesPoints.push(...summary.tokenSeriesPoints)
    }
  }

  return result
}

export async function refreshProjectDashboard({
  activeProjectDir,
  projectData,
  setProjectDashboard,
  loadSessionTelemetry,
  projectDashboardCacheRef,
}: RefreshProjectDashboardDeps) {
  if (!activeProjectDir || !projectData) {
    setProjectDashboard({
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
    return
  }

  const cached = projectDashboardCacheRef.current[activeProjectDir]
  if (cached) {
    setProjectDashboard({ ...cached, loading: true, error: undefined })
  } else {
    setProjectDashboard(current => ({ ...current, loading: true, error: undefined }))
  }

  try {
    const sessionsAll = [...projectData.sessions]
      .filter(item => !item.time.archived)
      .sort((a, b) => b.time.updated - a.time.updated)
    const latestSessionUpdatedAt = sessionsAll[0]?.time.updated ?? 0
    if (
      cached?.updatedAt &&
      Date.now() - cached.updatedAt <= 45_000 &&
      cached.sessionCount === sessionsAll.length &&
      (cached.recentSessions[0]?.updatedAt ?? 0) === latestSessionUpdatedAt
    ) {
      setProjectDashboard({ ...cached, loading: false, error: undefined })
      return
    }
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const recentSessions = sessionsAll.slice(0, 4).map(session => ({
      id: session.id,
      title: session.title || session.slug,
      updatedAt: session.time.updated,
      status: projectData.sessionStatus[session.id]?.type ?? 'idle',
    }))

    const telemetryCandidates = sessionsAll
      .filter(session => session.time.updated >= thirtyDaysAgo)
      .slice(0, 20)

    const telemetry = await aggregateProjectTelemetry(
      telemetryCandidates,
      activeProjectDir,
      loadSessionTelemetry
    )

    const nextState: ProjectDashboardState = {
      loading: false,
      updatedAt: now,
      sessions7d: sessionsAll.filter(item => item.time.updated >= sevenDaysAgo).length,
      sessions30d: sessionsAll.filter(item => item.time.updated >= thirtyDaysAgo).length,
      sessionCount: sessionsAll.length,
      tokenInput30d: telemetry.tokenInput30d,
      tokenOutput30d: telemetry.tokenOutput30d,
      tokenCacheRead30d: telemetry.tokenCacheRead30d,
      totalCost30d: telemetry.totalCost30d,
      topModels: topModelsFromUsage(telemetry.modelUsage),
      daySeries: buildDaySeries(telemetry.tokenSeriesPoints),
      recentSessions,
    }
    projectDashboardCacheRef.current[activeProjectDir] = nextState
    setProjectDashboard(nextState)
  } catch (error) {
    setProjectDashboard(current => ({
      ...current,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}
