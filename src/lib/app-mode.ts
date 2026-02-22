import type { AppMode } from "@shared/ipc";

export function preferredAgentForMode(params: {
  mode: AppMode;
  hasOrxaAgent: boolean;
  hasPlanAgent: boolean;
  serverAgentNames: Set<string>;
  firstAgentName?: string;
}) {
  const { mode, hasOrxaAgent, hasPlanAgent, serverAgentNames, firstAgentName } = params;
  if (mode === "standard") {
    if (serverAgentNames.has("build")) {
      return "build";
    }
    if (serverAgentNames.has("plan")) {
      return "plan";
    }
    return firstAgentName;
  }
  if (hasOrxaAgent) {
    return "orxa";
  }
  return firstAgentName ?? (hasPlanAgent ? "plan" : undefined);
}
