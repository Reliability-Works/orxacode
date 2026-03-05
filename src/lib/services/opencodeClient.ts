import type {
  ArtifactExportBundleInput,
  ArtifactExportBundleResult,
  ArtifactListQuery,
  ArtifactPruneResult,
  ArtifactRecord,
  ArtifactRetentionPolicy,
  ArtifactRetentionUpdateInput,
  ArtifactSessionSummary,
  ChangeProvenanceRecord,
  ExecutionLedgerSnapshot,
  GitBranchState,
  ProjectBootstrap,
  ProjectListItem,
  PromptRequest,
  SessionMessageBundle,
  SessionPermissionMode,
  SessionProvenanceSnapshot,
  WorkspaceArtifactSummary,
  WorkspaceContextFile,
  WorkspaceContextWriteInput,
} from "@shared/ipc";
import type { Session } from "@opencode-ai/sdk/v2/client";

export type BranchState = GitBranchState;

export type SendOptions = Omit<PromptRequest, "directory" | "sessionID" | "text">;

type RetryOptions = {
  retries?: number;
  delayMs?: number;
  retryable?: (error: unknown) => boolean;
};

class OpencodeClientError extends Error {
  readonly code: "IPC_UNAVAILABLE" | "TIMEOUT" | "NOT_FOUND" | "REJECTED" | "UNKNOWN";
  readonly retryable: boolean;

  constructor(message: string, code: OpencodeClientError["code"], retryable: boolean, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "OpencodeClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mapError(error: unknown) {
  if (error instanceof OpencodeClientError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const retryable =
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("econn") ||
    normalized.includes("epipe") ||
    normalized.includes("network") ||
    normalized.includes("temporar");
  const code = normalized.includes("timeout")
    ? "TIMEOUT"
    : normalized.includes("not found")
      ? "NOT_FOUND"
      : "UNKNOWN";
  return new OpencodeClientError(message, code, retryable, error);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function withRetry<T>(operation: string, run: () => Promise<T>, options: RetryOptions = {}) {
  const retries = options.retries ?? 1;
  const delayMs = options.delayMs ?? 220;
  const retryable = options.retryable ?? ((error) => mapError(error).retryable);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !retryable(error)) {
        break;
      }
      await delay(delayMs * (attempt + 1));
    }
  }

  throw mapError(lastError ?? new Error(`IPC operation failed: ${operation}`));
}

function getBridge() {
  if (!window.orxa?.opencode) {
    throw new OpencodeClientError("Desktop bridge unavailable. Restart Opencode Orxa to reconnect.", "IPC_UNAVAILABLE", false);
  }
  return window.orxa.opencode;
}

function expectTrue(result: boolean, operation: string) {
  if (!result) {
    throw new OpencodeClientError(`${operation} was rejected by the backend`, "REJECTED", false);
  }
}

export const opencodeClient = {
  async listProjects(): Promise<ProjectListItem[]> {
    return withRetry("listProjects", async () => {
      const data = await getBridge().bootstrap();
      return data.projects;
    }, { retries: 2 });
  },

  async addProjectDirectory(): Promise<{ directory: string } | null> {
    return withRetry("addProjectDirectory", async () => {
      const directory = await getBridge().addProjectDirectory();
      return directory ? { directory } : null;
    }, { retries: 0 });
  },

  async removeProjectDirectory(id: string): Promise<void> {
    return withRetry("removeProjectDirectory", async () => {
      const removed = await getBridge().removeProjectDirectory(id);
      expectTrue(removed, "removeProjectDirectory");
    }, { retries: 0 });
  },

  async refreshProject(directory: string): Promise<ProjectBootstrap> {
    return withRetry("refreshProject", () => getBridge().refreshProject(directory), { retries: 2 });
  },

  async createSession(directory: string, title?: string, permissionMode?: SessionPermissionMode): Promise<Session> {
    return withRetry("createSession", () => getBridge().createSession(directory, title, permissionMode), { retries: 0 });
  },

  async deleteSession(directory: string, sessionID: string): Promise<void> {
    return withRetry("deleteSession", async () => {
      const deleted = await getBridge().deleteSession(directory, sessionID);
      expectTrue(deleted, "deleteSession");
    }, { retries: 0 });
  },

  async abortSession(directory: string, sessionID: string): Promise<void> {
    return withRetry("abortSession", async () => {
      const aborted = await getBridge().abortSession(directory, sessionID);
      expectTrue(aborted, "abortSession");
    }, { retries: 0 });
  },

  async loadMessages(directory: string, sessionID: string): Promise<SessionMessageBundle[]> {
    return withRetry("loadMessages", () => getBridge().loadMessages(directory, sessionID), { retries: 2 });
  },

  async loadExecutionLedger(directory: string, sessionID: string, cursor = 0): Promise<ExecutionLedgerSnapshot> {
    return withRetry("loadExecutionLedger", () => getBridge().loadExecutionLedger(directory, sessionID, cursor), { retries: 1 });
  },

  async clearExecutionLedger(directory: string, sessionID: string): Promise<void> {
    return withRetry("clearExecutionLedger", async () => {
      const result = await getBridge().clearExecutionLedger(directory, sessionID);
      expectTrue(result, "clearExecutionLedger");
    }, { retries: 0 });
  },

  async loadChangeProvenance(directory: string, sessionID: string, cursor = 0): Promise<SessionProvenanceSnapshot> {
    return withRetry("loadChangeProvenance", () => getBridge().loadChangeProvenance(directory, sessionID, cursor), { retries: 1 });
  },

  async getFileProvenance(directory: string, sessionID: string, relativePath: string): Promise<ChangeProvenanceRecord[]> {
    return withRetry("getFileProvenance", () => getBridge().getFileProvenance(directory, sessionID, relativePath), { retries: 1 });
  },

  async sendPrompt(directory: string, sessionID: string, text: string, options?: SendOptions): Promise<void> {
    return withRetry("sendPrompt", async () => {
      const sent = await getBridge().sendPrompt({
        directory,
        sessionID,
        text,
        ...(options ?? {}),
      });
      expectTrue(sent, "sendPrompt");
    }, { retries: 0 });
  },

  async listArtifacts(query?: ArtifactListQuery): Promise<ArtifactRecord[]> {
    return withRetry("listArtifacts", () => getBridge().listArtifacts(query), { retries: 1 });
  },

  async getArtifact(id: string): Promise<ArtifactRecord | undefined> {
    return withRetry("getArtifact", () => getBridge().getArtifact(id), { retries: 0 });
  },

  async deleteArtifact(id: string): Promise<void> {
    return withRetry("deleteArtifact", async () => {
      const deleted = await getBridge().deleteArtifact(id);
      expectTrue(deleted, "deleteArtifact");
    }, { retries: 0 });
  },

  async listArtifactSessions(workspace: string): Promise<ArtifactSessionSummary[]> {
    return withRetry("listArtifactSessions", () => getBridge().listArtifactSessions(workspace), { retries: 1 });
  },

  async listWorkspaceArtifactSummary(workspace: string): Promise<WorkspaceArtifactSummary> {
    return withRetry("listWorkspaceArtifactSummary", () => getBridge().listWorkspaceArtifactSummary(workspace), { retries: 1 });
  },

  async getArtifactRetentionPolicy(): Promise<ArtifactRetentionPolicy> {
    return withRetry("getArtifactRetentionPolicy", () => getBridge().getArtifactRetentionPolicy(), { retries: 1 });
  },

  async setArtifactRetentionPolicy(input: ArtifactRetentionUpdateInput): Promise<ArtifactRetentionPolicy> {
    return withRetry("setArtifactRetentionPolicy", () => getBridge().setArtifactRetentionPolicy(input), { retries: 0 });
  },

  async pruneArtifactsNow(workspace?: string): Promise<ArtifactPruneResult> {
    return withRetry("pruneArtifactsNow", () => getBridge().pruneArtifactsNow(workspace), { retries: 0 });
  },

  async exportArtifactBundle(input: ArtifactExportBundleInput): Promise<ArtifactExportBundleResult> {
    return withRetry("exportArtifactBundle", () => getBridge().exportArtifactBundle(input), { retries: 0 });
  },

  async listWorkspaceContext(workspace: string): Promise<WorkspaceContextFile[]> {
    return withRetry("listWorkspaceContext", () => getBridge().listWorkspaceContext(workspace), { retries: 1 });
  },

  async readWorkspaceContext(workspace: string, id: string): Promise<WorkspaceContextFile> {
    return withRetry("readWorkspaceContext", () => getBridge().readWorkspaceContext(workspace, id), { retries: 1 });
  },

  async writeWorkspaceContext(input: WorkspaceContextWriteInput): Promise<WorkspaceContextFile> {
    return withRetry("writeWorkspaceContext", () => getBridge().writeWorkspaceContext(input), { retries: 0 });
  },

  async deleteWorkspaceContext(workspace: string, id: string): Promise<void> {
    return withRetry("deleteWorkspaceContext", async () => {
      const deleted = await getBridge().deleteWorkspaceContext(workspace, id);
      expectTrue(deleted, "deleteWorkspaceContext");
    }, { retries: 0 });
  },

  async gitDiff(directory: string): Promise<string> {
    return withRetry("gitDiff", () => getBridge().gitDiff(directory), { retries: 1 });
  },

  async gitLog(directory: string): Promise<string> {
    return withRetry("gitLog", () => getBridge().gitLog(directory), { retries: 1 });
  },

  async gitBranches(directory: string): Promise<BranchState> {
    return withRetry("gitBranches", () => getBridge().gitBranches(directory), { retries: 1 });
  },

  async gitCheckoutBranch(directory: string, branch: string): Promise<void> {
    await withRetry("gitCheckoutBranch", () => getBridge().gitCheckoutBranch(directory, branch), { retries: 0 });
  },
};
