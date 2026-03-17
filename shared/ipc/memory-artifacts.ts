export type MemoryPolicyMode = "conservative" | "balanced" | "aggressive" | "codebase-facts";

export type MemoryPolicy = {
  enabled: boolean;
  mode: MemoryPolicyMode;
  guidance: string;
  maxPromptMemories: number;
  maxCapturePerSession: number;
};

export type MemorySettings = {
  global: MemoryPolicy;
  directory?: string;
  workspace?: MemoryPolicy;
  hasWorkspaceOverride: boolean;
};

export type MemorySettingsUpdateInput = {
  directory?: string;
  global?: Partial<MemoryPolicy>;
  workspace?: Partial<MemoryPolicy>;
  clearWorkspaceOverride?: boolean;
};

export type MemoryTemplate = {
  id: string;
  name: string;
  description: string;
  policy: MemoryPolicy;
};

export type MemoryNode = {
  id: string;
  workspace: string;
  summary: string;
  content: string;
  confidence: number;
  tags: string[];
  source: {
    sessionID?: string;
    messageID?: string;
    actor?: string;
  };
  createdAt: number;
  updatedAt: number;
};

export type MemoryEdge = {
  id: string;
  workspace: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
  createdAt: number;
  updatedAt: number;
};

export type MemoryGraphQuery = {
  workspace?: string;
  query?: string;
  relation?: string;
  limit?: number;
};

export type MemoryGraphSnapshot = {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  workspaces: string[];
  updatedAt: number;
};

export type MemoryBackfillStatus = {
  running: boolean;
  progress: number;
  scannedSessions: number;
  totalSessions: number;
  inserted: number;
  updated: number;
  startedAt?: number;
  completedAt?: number;
  message?: string;
};

export type ArtifactKind = "browser.screenshot" | "context.selection";

export type ArtifactRecord = {
  id: string;
  workspace: string;
  workspaceHash: string;
  sessionID: string;
  kind: ArtifactKind;
  createdAt: number;
  mime?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  title?: string;
  url?: string;
  actionID?: string;
  artifactPath?: string;
  fileUrl?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactListQuery = {
  workspace?: string;
  sessionID?: string;
  kind?: ArtifactKind | ArtifactKind[];
  limit?: number;
};

export type ArtifactSessionSummary = {
  sessionID: string;
  artifacts: number;
  screenshots: number;
  contextSelections: number;
  bytes: number;
  lastCreatedAt?: number;
};

export type WorkspaceArtifactSummary = {
  workspace: string;
  workspaceHash: string;
  sessions: number;
  artifacts: number;
  screenshots: number;
  contextSelections: number;
  bytes: number;
  lastCreatedAt?: number;
};

export type ArtifactRetentionPolicy = {
  maxBytes: number;
  totalBytes: number;
  artifactCount: number;
  fileArtifactCount: number;
  updatedAt: number;
};

export type ArtifactRetentionUpdateInput = {
  maxBytes: number;
};

export type ArtifactPruneResult = {
  removed: number;
  removedBytes: number;
  totalBytes: number;
  artifactCount: number;
  maxBytes: number;
};

export type ArtifactExportBundleInput = {
  workspace: string;
  sessionID?: string;
  kind?: ArtifactKind | ArtifactKind[];
  limit?: number;
};

export type ArtifactExportBundleResult = {
  bundlePath: string;
  manifestPath: string;
  exportedArtifacts: number;
  copiedFiles: number;
  totalBytes: number;
  createdAt: number;
};

export type WorkspaceContextFile = {
  id: string;
  workspace: string;
  filename: string;
  path: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceContextWriteInput = {
  workspace: string;
  id?: string;
  filename?: string;
  title?: string;
  content: string;
};

export type ContextSelectionTrace = {
  id: string;
  workspace: string;
  sessionID: string;
  query: string;
  mode: "hybrid_lexical_v1";
  selected: Array<{
    contextID: string;
    filename: string;
    title: string;
    heading: string;
    score: number;
    snippet: string;
  }>;
  createdAt: number;
};
