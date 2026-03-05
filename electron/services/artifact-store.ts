import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import type {
  ArtifactExportBundleInput,
  ArtifactExportBundleResult,
  ArtifactKind,
  ArtifactListQuery,
  ArtifactPruneResult,
  ArtifactRecord,
  ArtifactRetentionPolicy,
  ArtifactRetentionUpdateInput,
  ArtifactSessionSummary,
  ContextSelectionTrace,
  WorkspaceArtifactSummary,
} from "../../shared/ipc";

const ARTIFACTS_DIR = "artifacts";
const ARTIFACTS_VERSION = "v1";
const INDEX_FILE = "index.jsonl";
const SETTINGS_FILE = "settings.json";
const EXPORTS_DIR = "exports";
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MIN_MAX_BYTES = 8 * 1024 * 1024;
const MAX_MAX_BYTES = 8 * 1024 * 1024 * 1024;

type ArtifactStoreOptions = {
  rootDir?: string;
  maxBytes?: number;
  now?: () => number;
  createID?: () => string;
};

type ArtifactStoreSettings = {
  maxBytes: number;
  updatedAt: number;
};

type WriteImageArtifactInput = {
  workspace: string;
  sessionID: string;
  kind?: ArtifactKind;
  mime: string;
  buffer: Buffer;
  width?: number;
  height?: number;
  title?: string;
  url?: string;
  actionID?: string;
  metadata?: Record<string, unknown>;
};

type WriteContextTraceArtifactInput = {
  workspace: string;
  sessionID: string;
  trace: ContextSelectionTrace;
};

function normalizeWorkspace(workspace: string) {
  return workspace.replace(/\\/g, "/").trim();
}

function workspaceHash(workspace: string) {
  return createHash("sha256").update(normalizeWorkspace(workspace)).digest("hex").slice(0, 16);
}

function fileExtensionForMime(mime: string) {
  if (mime === "image/jpeg") {
    return "jpg";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  return "png";
}

function parseRecord(line: string): ArtifactRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as ArtifactRecord;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.id !== "string" || typeof parsed.workspace !== "string" || typeof parsed.sessionID !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clampRetentionBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_BYTES;
  }
  return Math.max(MIN_MAX_BYTES, Math.min(MAX_MAX_BYTES, Math.floor(value)));
}

function normalizeLimit(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function toKindList(kind?: ArtifactKind | ArtifactKind[]) {
  if (!kind) {
    return undefined;
  }
  if (Array.isArray(kind)) {
    return kind;
  }
  return [kind];
}

function matchRecord(record: ArtifactRecord, query: {
  workspace?: string;
  sessionID?: string;
  kind?: ArtifactKind | ArtifactKind[];
}) {
  if (query.workspace && normalizeWorkspace(query.workspace) !== normalizeWorkspace(record.workspace)) {
    return false;
  }
  if (query.sessionID && query.sessionID !== record.sessionID) {
    return false;
  }
  const kinds = toKindList(query.kind);
  if (kinds && !kinds.includes(record.kind)) {
    return false;
  }
  return true;
}

export class ArtifactStore {
  private readonly rootDir: string;

  private maxBytes: number;

  private readonly now: () => number;

  private readonly createID: () => string;

  private settingsUpdatedAt: number;

  private settingsLoaded: boolean;

  constructor(options: ArtifactStoreOptions = {}) {
    const base = options.rootDir ?? path.join(app.getPath("userData"), ARTIFACTS_DIR, ARTIFACTS_VERSION);
    this.rootDir = base;
    this.maxBytes = clampRetentionBytes(options.maxBytes);
    this.now = options.now ?? (() => Date.now());
    this.createID = options.createID ?? (() => randomUUID());
    this.settingsUpdatedAt = this.now();
    this.settingsLoaded = options.maxBytes !== undefined;
  }

  async writeImageArtifact(input: WriteImageArtifactInput): Promise<ArtifactRecord> {
    await this.ensureSettingsLoaded();
    const workspace = normalizeWorkspace(input.workspace);
    const wHash = workspaceHash(workspace);
    const id = this.createID();
    const extension = fileExtensionForMime(input.mime);
    const sessionID = input.sessionID.trim() || "unknown-session";
    const dir = path.join(this.rootDir, wHash, sessionID);
    await mkdir(dir, { recursive: true });
    const fileName = `${id}.${extension}`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, input.buffer);
    const info = await stat(filePath);

    const record: ArtifactRecord = {
      id,
      workspace,
      workspaceHash: wHash,
      sessionID,
      kind: input.kind ?? "browser.screenshot",
      createdAt: this.now(),
      mime: input.mime,
      sizeBytes: info.size,
      width: input.width,
      height: input.height,
      title: input.title,
      url: input.url,
      actionID: input.actionID,
      artifactPath: filePath,
      fileUrl: pathToFileURL(filePath).toString(),
      metadata: input.metadata,
    };

    await this.appendRecord(record);
    await this.pruneIfNeeded();
    return record;
  }

  async writeContextSelectionArtifact(input: WriteContextTraceArtifactInput): Promise<ArtifactRecord> {
    const workspace = normalizeWorkspace(input.workspace);
    const wHash = workspaceHash(workspace);
    const record: ArtifactRecord = {
      id: this.createID(),
      workspace,
      workspaceHash: wHash,
      sessionID: input.sessionID.trim() || "unknown-session",
      kind: "context.selection",
      createdAt: this.now(),
      text: input.trace.query,
      metadata: {
        trace: input.trace,
      },
    };
    await this.appendRecord(record);
    return record;
  }

  async list(query: ArtifactListQuery = {}): Promise<ArtifactRecord[]> {
    const all = await this.readAll();
    const filtered = all.filter((item) => matchRecord(item, query));
    const limit = normalizeLimit(query.limit, DEFAULT_LIMIT);
    return filtered.slice(0, limit > 0 ? limit : DEFAULT_LIMIT);
  }

  async get(id: string): Promise<ArtifactRecord | undefined> {
    const all = await this.readAll();
    return all.find((item) => item.id === id);
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.readAll();
    const target = all.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    if (target.artifactPath) {
      await rm(target.artifactPath, { force: true }).catch(() => undefined);
    }
    const next = all.filter((item) => item.id !== id);
    await this.writeAll(next);
    return true;
  }

  async listSessions(workspace: string): Promise<ArtifactSessionSummary[]> {
    const records = await this.list({ workspace, limit: Number.MAX_SAFE_INTEGER });
    const bySession = new Map<string, ArtifactSessionSummary>();
    for (const record of records) {
      const existing = bySession.get(record.sessionID) ?? {
        sessionID: record.sessionID,
        artifacts: 0,
        screenshots: 0,
        contextSelections: 0,
        bytes: 0,
        lastCreatedAt: undefined,
      };
      existing.artifacts += 1;
      if (record.kind === "browser.screenshot") {
        existing.screenshots += 1;
      }
      if (record.kind === "context.selection") {
        existing.contextSelections += 1;
      }
      existing.bytes += record.sizeBytes ?? 0;
      existing.lastCreatedAt = Math.max(existing.lastCreatedAt ?? 0, record.createdAt);
      bySession.set(record.sessionID, existing);
    }
    return [...bySession.values()].sort((a, b) => (b.lastCreatedAt ?? 0) - (a.lastCreatedAt ?? 0));
  }

  async listWorkspaceSummary(workspace: string): Promise<WorkspaceArtifactSummary> {
    const normalized = normalizeWorkspace(workspace);
    const records = await this.list({ workspace: normalized, limit: Number.MAX_SAFE_INTEGER });
    const sessions = new Set(records.map((item) => item.sessionID));
    return {
      workspace: normalized,
      workspaceHash: workspaceHash(normalized),
      sessions: sessions.size,
      artifacts: records.length,
      screenshots: records.filter((item) => item.kind === "browser.screenshot").length,
      contextSelections: records.filter((item) => item.kind === "context.selection").length,
      bytes: records.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0),
      lastCreatedAt: records[0]?.createdAt,
    };
  }

  async getRetentionPolicy(): Promise<ArtifactRetentionPolicy> {
    await this.ensureSettingsLoaded();
    const all = await this.readAll();
    const fileArtifacts = all.filter((item) => Boolean(item.artifactPath));
    return {
      maxBytes: this.maxBytes,
      totalBytes: fileArtifacts.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0),
      artifactCount: all.length,
      fileArtifactCount: fileArtifacts.length,
      updatedAt: this.settingsUpdatedAt,
    };
  }

  async setRetentionPolicy(input: ArtifactRetentionUpdateInput): Promise<ArtifactRetentionPolicy> {
    await this.ensureSettingsLoaded();
    this.maxBytes = clampRetentionBytes(input.maxBytes);
    this.settingsUpdatedAt = this.now();
    await this.persistSettings();
    await this.prune();
    return this.getRetentionPolicy();
  }

  async prune(query: { workspace?: string } = {}): Promise<ArtifactPruneResult> {
    await this.ensureSettingsLoaded();
    const all = await this.readAll();
    const fileArtifacts = all.filter((item) => Boolean(item.artifactPath));
    let totalBytes = fileArtifacts.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
    const normalizedWorkspace = query.workspace ? normalizeWorkspace(query.workspace) : undefined;
    const candidates = fileArtifacts
      .filter((item) => !normalizedWorkspace || normalizeWorkspace(item.workspace) === normalizedWorkspace)
      .sort((a, b) => a.createdAt - b.createdAt);

    let removed = 0;
    let removedBytes = 0;
    const pruneIDs = new Set<string>();
    for (const candidate of candidates) {
      if (totalBytes <= this.maxBytes) {
        break;
      }
      pruneIDs.add(candidate.id);
      const itemSize = candidate.sizeBytes ?? 0;
      totalBytes = Math.max(0, totalBytes - itemSize);
      removed += 1;
      removedBytes += itemSize;
      if (candidate.artifactPath) {
        await rm(candidate.artifactPath, { force: true }).catch(() => undefined);
      }
    }
    const nextRecords = pruneIDs.size > 0 ? all.filter((item) => !pruneIDs.has(item.id)) : all;
    if (pruneIDs.size > 0) {
      await this.writeAll(nextRecords);
    }
    return {
      removed,
      removedBytes,
      totalBytes,
      artifactCount: nextRecords.length,
      maxBytes: this.maxBytes,
    };
  }

  async exportBundle(input: ArtifactExportBundleInput): Promise<ArtifactExportBundleResult> {
    const workspace = normalizeWorkspace(input.workspace);
    const all = await this.readAll();
    const limit = normalizeLimit(input.limit, all.length);
    const filtered = all.filter((item) =>
      matchRecord(item, {
        workspace,
        sessionID: input.sessionID,
        kind: input.kind,
      })
    );
    const selected = filtered.slice(0, limit > 0 ? limit : filtered.length);

    const createdAt = this.now();
    const exportRoot = path.join(this.rootDir, EXPORTS_DIR);
    await mkdir(exportRoot, { recursive: true });
    const bundleFolderName = `${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}-${this.createID().slice(0, 8)}`;
    const bundlePath = path.join(exportRoot, bundleFolderName);
    const filesPath = path.join(bundlePath, "files");
    await mkdir(filesPath, { recursive: true });

    let copiedFiles = 0;
    let totalBytes = 0;
    const manifestRecords: Array<ArtifactRecord & { bundleFile?: string }> = [];
    for (const item of selected) {
      let bundleFile: string | undefined;
      if (item.artifactPath) {
        const extension = path.extname(item.artifactPath);
        const destinationName = `${item.id}${extension || ""}`;
        const destinationPath = path.join(filesPath, destinationName);
        const copied = await copyFile(item.artifactPath, destinationPath).then(() => true).catch(() => false);
        if (copied) {
          copiedFiles += 1;
          bundleFile = `files/${destinationName}`;
          const copiedInfo = await stat(destinationPath).catch(() => undefined);
          totalBytes += copiedInfo?.size ?? item.sizeBytes ?? 0;
        }
      }
      manifestRecords.push({
        ...item,
        bundleFile,
      });
    }

    const manifestPath = path.join(bundlePath, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      createdAt,
      query: {
        workspace,
        sessionID: input.sessionID,
        kind: input.kind,
        limit: input.limit,
      },
      exportedArtifacts: manifestRecords.length,
      copiedFiles,
      totalBytes,
      records: manifestRecords,
    }, null, 2), "utf8");

    return {
      bundlePath,
      manifestPath,
      exportedArtifacts: manifestRecords.length,
      copiedFiles,
      totalBytes,
      createdAt,
    };
  }

  private async indexPath() {
    await mkdir(this.rootDir, { recursive: true });
    return path.join(this.rootDir, INDEX_FILE);
  }

  private async settingsPath() {
    await mkdir(this.rootDir, { recursive: true });
    return path.join(this.rootDir, SETTINGS_FILE);
  }

  private async ensureSettingsLoaded() {
    if (this.settingsLoaded) {
      return;
    }
    const settingsPath = await this.settingsPath();
    const raw = await readFile(settingsPath, "utf8").catch(() => "");
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as Partial<ArtifactStoreSettings>;
        this.maxBytes = clampRetentionBytes(parsed.maxBytes);
        this.settingsUpdatedAt =
          typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
            ? parsed.updatedAt
            : this.now();
      } catch {
        this.maxBytes = clampRetentionBytes(this.maxBytes);
        this.settingsUpdatedAt = this.now();
      }
    } else {
      this.maxBytes = clampRetentionBytes(this.maxBytes);
      this.settingsUpdatedAt = this.now();
      await this.persistSettings();
    }
    this.settingsLoaded = true;
  }

  private async persistSettings() {
    const settingsPath = await this.settingsPath();
    await writeFile(settingsPath, JSON.stringify({
      maxBytes: this.maxBytes,
      updatedAt: this.settingsUpdatedAt,
    }, null, 2), "utf8");
  }

  private async readAll(): Promise<ArtifactRecord[]> {
    const indexPath = await this.indexPath();
    const raw = await readFile(indexPath, "utf8").catch(() => "");
    if (!raw) {
      return [];
    }
    return raw
      .split(/\r?\n/)
      .map((line) => parseRecord(line))
      .filter((item): item is ArtifactRecord => Boolean(item))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private async appendRecord(record: ArtifactRecord) {
    const all = await this.readAll();
    await this.writeAll([record, ...all]);
  }

  private async writeAll(records: ArtifactRecord[]) {
    const indexPath = await this.indexPath();
    const payload = records.map((item) => JSON.stringify(item)).join("\n");
    await writeFile(indexPath, payload.length > 0 ? `${payload}\n` : "", "utf8");
  }

  private async pruneIfNeeded() {
    await this.prune();
  }
}
