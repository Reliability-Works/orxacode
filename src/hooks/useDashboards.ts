import { useCallback, useState } from "react";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { ProjectBootstrap, ProjectListItem } from "@shared/ipc";

export type Project = ProjectListItem;
export type ProjectData = ProjectBootstrap;

export type HomeDashboardState = {
  loading: boolean;
  updatedAt?: number;
  error?: string;
  recentSessions: Array<{
    id: string;
    title: string;
    project: string;
    updatedAt: number;
  }>;
  sessions7d: number;
  sessions30d: number;
  projects: number;
  providersConnected: number;
  topModels: Array<{
    model: string;
    count: number;
  }>;
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  daySeries: Array<{
    label: string;
    count: number;
  }>;
};

export type ProjectDashboardState = {
  loading: boolean;
  updatedAt?: number;
  error?: string;
  sessions7d: number;
  sessions30d: number;
  sessionCount: number;
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  topModels: Array<{
    model: string;
    count: number;
  }>;
  daySeries: Array<{
    label: string;
    count: number;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    updatedAt: number;
    status: string;
  }>;
};

function buildDaySeries(points: Array<{ timestamp: number; value: number }>) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const slots = Array.from({ length: 7 }, (_, reverseIndex) => {
    const index = 6 - reverseIndex;
    const start = now - (index + 1) * msPerDay;
    const end = start + msPerDay;
    return {
      start,
      end,
      label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
    };
  });

  for (const point of points) {
    const slot = slots.find((item) => point.timestamp >= item.start && point.timestamp < item.end);
    if (slot) {
      slot.count += point.value;
    }
  }

  return slots.map((item) => ({ label: item.label, count: item.count }));
}

function summarizeStepFinishParts(parts: Part[]) {
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let cost = 0;
  let totalTokens = 0;

  for (const part of parts) {
    if (part.type !== "step-finish") {
      continue;
    }
    tokenInput += part.tokens.input ?? 0;
    tokenOutput += part.tokens.output ?? 0;
    tokenCacheRead += part.tokens.cache.read ?? 0;
    totalTokens += (part.tokens.input ?? 0) + (part.tokens.output ?? 0);
    cost += part.cost ?? 0;
  }

  return {
    tokenInput,
    tokenOutput,
    tokenCacheRead,
    totalTokens,
    cost,
  };
}

function topModelsFromUsage(modelUsage: Map<string, number>) {
  const groupedModels = new Map<string, number>();
  for (const [model, count] of modelUsage.entries()) {
    const trimmed = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
    groupedModels.set(trimmed, (groupedModels.get(trimmed) ?? 0) + count);
  }
  return [...groupedModels.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

export function useDashboards(projects: Project[], activeProjectDir: string | null, projectData: ProjectData | null) {
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
  });

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
  });

  const refreshDashboard = useCallback(async () => {
    setDashboard((current) => ({ ...current, loading: true, error: undefined, projects: projects.length }));
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
      });
      return;
    }

    try {
      const snapshots = await Promise.all(
        projects.map(async (project) => {
          try {
            const data = await window.orxa.opencode.refreshProject(project.worktree);
            return { project, data };
          } catch {
            return { project, data: undefined };
          }
        }),
      );

      const sessionTimes: number[] = [];
      const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = [];
      const recentSessions: HomeDashboardState["recentSessions"] = [];
      const connectedProviders = new Set<string>();
      const modelUsage = new Map<string, number>();
      const telemetryCandidates: Array<{ directory: string; sessionID: string; updatedAt: number }> = [];
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      let tokenInput30d = 0;
      let tokenOutput30d = 0;
      let tokenCacheRead30d = 0;
      let totalCost30d = 0;

      for (const snapshot of snapshots) {
        const data = snapshot.data;
        if (!data) {
          continue;
        }

        for (const provider of data.providers.connected) {
          connectedProviders.add(provider);
        }

        const modelHints = [data.config.model, data.config.small_model].filter((item): item is string => Boolean(item));
        for (const modelHint of modelHints) {
          modelUsage.set(modelHint, (modelUsage.get(modelHint) ?? 0) + 1);
        }

        for (const session of data.sessions) {
          sessionTimes.push(session.time.updated);
          if (session.time.updated >= thirtyDaysAgo) {
            telemetryCandidates.push({
              directory: data.directory,
              sessionID: session.id,
              updatedAt: session.time.updated,
            });
          }
          recentSessions.push({
            id: `${snapshot.project.id}:${session.id}`,
            title: session.title || session.slug,
            project: snapshot.project.name || snapshot.project.worktree.split("/").at(-1) || snapshot.project.worktree,
            updatedAt: session.time.updated,
          });
        }
      }

      const recentTelemetrySessions = telemetryCandidates
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 60);

      if (recentTelemetrySessions.length > 0) {
        const telemetryMessages = await Promise.all(
          recentTelemetrySessions.map(async (candidate) => {
            try {
              return await window.orxa.opencode.loadMessages(candidate.directory, candidate.sessionID);
            } catch {
              return [];
            }
          }),
        );

        for (let index = 0; index < telemetryMessages.length; index += 1) {
          const sessionMessages = telemetryMessages[index] ?? [];
          const fallbackTimestamp = recentTelemetrySessions[index]?.updatedAt ?? now;
          for (const message of sessionMessages) {
            const info = message.info as { role?: string; providerID?: string; modelID?: string };
            if (info.role === "assistant" && info.providerID && info.modelID) {
              const modelKey = `${info.providerID}/${info.modelID}`;
              modelUsage.set(modelKey, (modelUsage.get(modelKey) ?? 0) + 1);
            }
            const summary = summarizeStepFinishParts(message.parts);
            tokenInput30d += summary.tokenInput;
            tokenOutput30d += summary.tokenOutput;
            tokenCacheRead30d += summary.tokenCacheRead;
            totalCost30d += summary.cost;
            if (summary.totalTokens > 0) {
              const created = (message.info as { time?: { created?: number } }).time?.created;
              tokenSeriesPoints.push({
                timestamp: typeof created === "number" ? created : fallbackTimestamp,
                value: summary.totalTokens,
              });
            }
          }
        }
      }

      recentSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      setDashboard({
        loading: false,
        updatedAt: now,
        recentSessions,
        sessions7d: sessionTimes.filter((time) => time >= sevenDaysAgo).length,
        sessions30d: sessionTimes.filter((time) => time >= thirtyDaysAgo).length,
        projects: projects.length,
        providersConnected: connectedProviders.size,
        topModels: topModelsFromUsage(modelUsage),
        tokenInput30d,
        tokenOutput30d,
        tokenCacheRead30d,
        totalCost30d,
        daySeries: buildDaySeries(tokenSeriesPoints),
      });
    } catch (error) {
      setDashboard((current) => ({
        ...current,
        loading: false,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [projects]);

  const refreshProjectDashboard = useCallback(async () => {
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
      });
      return;
    }

    setProjectDashboard((current) => ({ ...current, loading: true, error: undefined }));

    try {
      const sessionsAll = [...projectData.sessions]
        .filter((item) => !item.time.archived)
        .sort((a, b) => b.time.updated - a.time.updated);
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      const recentSessions = sessionsAll.slice(0, 4).map((session) => ({
        id: session.id,
        title: session.title || session.slug,
        updatedAt: session.time.updated,
        status: projectData.sessionStatus[session.id]?.type ?? "idle",
      }));

      const telemetryCandidates = sessionsAll
        .filter((session) => session.time.updated >= thirtyDaysAgo)
        .slice(0, 40);

      let tokenInput30d = 0;
      let tokenOutput30d = 0;
      let tokenCacheRead30d = 0;
      let totalCost30d = 0;
      const modelUsage = new Map<string, number>();
      const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = [];

      for (const session of telemetryCandidates) {
        const payload = await window.orxa.opencode.loadMessages(activeProjectDir, session.id).catch(() => []);
        for (const message of payload) {
          const info = message.info as { role?: string; providerID?: string; modelID?: string; time?: { created?: number } };
          if (info.role === "assistant" && info.providerID && info.modelID) {
            const key = `${info.providerID}/${info.modelID}`;
            modelUsage.set(key, (modelUsage.get(key) ?? 0) + 1);
          }
          const summary = summarizeStepFinishParts(message.parts);
          tokenInput30d += summary.tokenInput;
          tokenOutput30d += summary.tokenOutput;
          tokenCacheRead30d += summary.tokenCacheRead;
          totalCost30d += summary.cost;
          if (summary.totalTokens > 0) {
            tokenSeriesPoints.push({
              timestamp: typeof info.time?.created === "number" ? info.time.created : session.time.updated,
              value: summary.totalTokens,
            });
          }
        }
      }

      setProjectDashboard({
        loading: false,
        updatedAt: now,
        sessions7d: sessionsAll.filter((item) => item.time.updated >= sevenDaysAgo).length,
        sessions30d: sessionsAll.filter((item) => item.time.updated >= thirtyDaysAgo).length,
        sessionCount: sessionsAll.length,
        tokenInput30d,
        tokenOutput30d,
        tokenCacheRead30d,
        totalCost30d,
        topModels: topModelsFromUsage(modelUsage),
        daySeries: buildDaySeries(tokenSeriesPoints),
        recentSessions,
      });
    } catch (error) {
      setProjectDashboard((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [activeProjectDir, projectData]);

  return {
    dashboard,
    projectDashboard,
    refreshDashboard,
    refreshProjectDashboard,
  };
}
