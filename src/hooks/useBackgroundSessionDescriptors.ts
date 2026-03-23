import { useMemo } from "react";
import type { ProjectBootstrap } from "@shared/ipc";
import { getPersistedCodexState } from "./codex-session-storage";
import {
  buildClaudeChatSessionStatus,
  buildClaudeSessionStatus,
  buildOpencodeSessionStatus,
  selectActiveBackgroundAgentsPresentation,
  selectClaudeChatSessionRuntime,
  useUnifiedRuntimeStore,
} from "../state/unified-runtime-store";
import { buildWorkspaceSessionMetadataKey } from "../lib/workspace-session-metadata";
import type { BackgroundSessionDescriptor } from "../lib/background-session-descriptors";
import type { UnifiedBackgroundAgentSummary } from "../lib/session-presentation";

type UseBackgroundSessionDescriptorsInput = {
  activeProjectDir?: string;
  activeSessionID?: string;
  activeSessionKey?: string;
  activeSessionType?: string;
  cachedProjects: Record<string, ProjectBootstrap>;
  archivedBackgroundAgentIds: Record<string, string[]>;
  getSessionType: (sessionID: string, directory?: string) => string | undefined;
  normalizePresentationProvider: (sessionType: string | undefined) => "opencode" | "codex" | "claude" | "claude-chat" | undefined;
};

export function useBackgroundSessionDescriptors({
  activeProjectDir,
  activeSessionID,
  activeSessionKey,
  activeSessionType,
  cachedProjects,
  archivedBackgroundAgentIds,
  getSessionType,
  normalizePresentationProvider,
}: UseBackgroundSessionDescriptorsInput) {
  const codexSessionStateMap = useUnifiedRuntimeStore((state) => state.codexSessions);
  const opencodeSessionStateMap = useUnifiedRuntimeStore((state) => state.opencodeSessions);
  const claudeChatSessionStateMap = useUnifiedRuntimeStore((state) => state.claudeChatSessions);
  const claudeSessionStateMap = useUnifiedRuntimeStore((state) => state.claudeSessions);

  const backgroundSessionDescriptors = useMemo<BackgroundSessionDescriptor[]>(() => {
    void opencodeSessionStateMap;
    const next: BackgroundSessionDescriptor[] = [];
    const seenCodexKeys = new Set<string>();

    for (const [directory, data] of Object.entries(cachedProjects)) {
      for (const session of data.sessions) {
        const sessionType = getSessionType(session.id, directory);
        const sessionStorageKey = buildWorkspaceSessionMetadataKey(directory, session.id);
        if (sessionStorageKey === activeSessionKey) {
          continue;
        }

        if (sessionType === "codex") {
          if (seenCodexKeys.has(sessionStorageKey)) {
            continue;
          }
          const runtime = codexSessionStateMap[sessionStorageKey];
          const persisted = getPersistedCodexState(sessionStorageKey);
          const hasBackgroundRuntime =
            Boolean(runtime?.thread) ||
            Boolean(runtime?.isStreaming) ||
            (runtime?.messages.length ?? 0) > 0 ||
            Boolean(persisted.thread) ||
            Boolean(persisted.isStreaming) ||
            persisted.messages.length > 0;
          if (!hasBackgroundRuntime) {
            continue;
          }
          seenCodexKeys.add(sessionStorageKey);
          next.push({
            key: `codex:${sessionStorageKey}`,
            provider: "codex",
            directory,
            sessionStorageKey,
          });
          continue;
        }

        if (normalizePresentationProvider(sessionType) === "opencode") {
          const status = buildOpencodeSessionStatus(directory, session.id, false, sessionStorageKey);
          if (status.type === "busy" || status.type === "awaiting") {
            next.push({
              key: `opencode:${directory}:${session.id}`,
              provider: "opencode",
              directory,
              sessionID: session.id,
            });
          }
          continue;
        }

        if (sessionType === "claude") {
          const status = buildClaudeSessionStatus(sessionStorageKey, false);
          if (status.type === "busy" || status.type === "awaiting") {
            next.push({
              key: `claude:${sessionStorageKey}`,
              provider: "claude",
              directory,
              sessionStorageKey,
            });
          }
          continue;
        }

        if (sessionType === "claude-chat") {
          const runtime = claudeChatSessionStateMap[sessionStorageKey] ?? selectClaudeChatSessionRuntime(sessionStorageKey);
          const hasBackgroundRuntime =
            Boolean(runtime?.providerThreadId) ||
            Boolean(runtime?.isStreaming) ||
            Boolean(runtime?.pendingApproval) ||
            Boolean(runtime?.pendingUserInput) ||
            (runtime?.messages.length ?? 0) > 0 ||
            (runtime?.subagents.length ?? 0) > 0;
          if (!hasBackgroundRuntime) {
            continue;
          }
          const status = buildClaudeChatSessionStatus(sessionStorageKey, false);
          if (status.type === "busy" || status.type === "awaiting") {
            next.push({
              key: `claude-chat:${sessionStorageKey}`,
              provider: "claude-chat",
              directory,
              sessionStorageKey,
            });
          }
        }
      }
    }

    return next;
  }, [
    activeSessionKey,
    cachedProjects,
    claudeChatSessionStateMap,
    codexSessionStateMap,
    getSessionType,
    normalizePresentationProvider,
    opencodeSessionStateMap,
  ]);

  const activeBackgroundAgents = useMemo<UnifiedBackgroundAgentSummary[]>(
    () => {
      void codexSessionStateMap;
      void claudeSessionStateMap;
      void claudeChatSessionStateMap;
      void opencodeSessionStateMap;
      return selectActiveBackgroundAgentsPresentation({
        provider: normalizePresentationProvider(activeSessionType),
        directory: activeProjectDir,
        sessionID: activeSessionID,
        sessionKey: activeSessionKey,
      });
    },
    [
      activeProjectDir,
      activeSessionID,
      activeSessionKey,
      activeSessionType,
      claudeChatSessionStateMap,
      claudeSessionStateMap,
      codexSessionStateMap,
      normalizePresentationProvider,
      opencodeSessionStateMap,
    ],
  );

  const visibleBackgroundAgents = useMemo(() => {
    if (!activeProjectDir) {
      return activeBackgroundAgents;
    }
    const hiddenIds = new Set(archivedBackgroundAgentIds[activeProjectDir] ?? []);
    return activeBackgroundAgents.filter((agent) => {
      if (hiddenIds.has(agent.id)) {
        return false;
      }
      if (agent.sessionID && hiddenIds.has(agent.sessionID)) {
        return false;
      }
      return true;
    });
  }, [activeBackgroundAgents, activeProjectDir, archivedBackgroundAgentIds]);

  return {
    backgroundSessionDescriptors,
    activeBackgroundAgents,
    visibleBackgroundAgents,
  };
}
