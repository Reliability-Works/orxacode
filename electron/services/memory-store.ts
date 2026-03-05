import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type {
  MemoryEdge,
  MemoryGraphQuery,
  MemoryGraphSnapshot,
  MemoryNode,
  MemoryPolicy,
  MemoryPolicyMode,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemoryTemplate,
  SessionMessageBundle,
} from "../../shared/ipc";

const MEMORY_DB_DIR = "memory-store";
const MEMORY_DB_FILE = "memory.sqlite";
const MEMORY_KEY_SERVICE = "orxacode-opencode-memory";
const MEMORY_KEY_ACCOUNT = "orxa.memory.key.v1";
const MAX_GRAPH_NODES = 700;
const MAX_GRAPH_EDGES = 2500;
const MAX_GUIDANCE_LENGTH = 4_000;
const MAX_PROMPT_CONTEXT_ITEMS = 12;
const MAX_CAPTURE_PER_SESSION = 60;
const MEMORY_POLICY_MODES: ReadonlyArray<MemoryPolicyMode> = ["conservative", "balanced", "aggressive", "codebase-facts"];
const PROMPT_STOPWORDS = new Set([
  "all",
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "get",
  "help",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "to",
  "up",
  "use",
  "want",
  "we",
  "with",
  "you",
  "your",
]);

type MemoryItemRow = {
  id: string;
  workspace: string;
  summary: string;
  content_enc: string;
  confidence: number;
  tags_json: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_actor: string | null;
  created_at: number;
  updated_at: number;
};

type MemoryPolicyRow = {
  enabled: number;
  mode: string;
  guidance_enc: string;
  max_prompt_memories: number;
  max_capture_per_session: number;
  updated_at: number;
};

type MemoryCandidate = {
  content: string;
  summary: string;
  tags: string[];
  confidence: number;
  messageID?: string;
  actor?: string;
  workspace?: string;
};

type MemoryIngestStats = {
  inserted: number;
  updated: number;
};

type MemoryPromptEntry = {
  summary: string;
  content: string;
  confidence: number;
  tags: string[];
};

function now() {
  return Date.now();
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWorkspace(workspace: string) {
  return workspace.replace(/\\/g, "/");
}

function normalizePolicyMode(mode: string): MemoryPolicyMode {
  return MEMORY_POLICY_MODES.includes(mode as MemoryPolicyMode) ? (mode as MemoryPolicyMode) : "balanced";
}

function scopeForWorkspace(workspace: string) {
  return `workspace:${normalizeWorkspace(workspace)}`;
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0)
          .slice(0, 12),
      ),
    ];
  } catch {
    return [] as string[];
  }
}

function serializeTags(tags: string[]) {
  return JSON.stringify(
    [
      ...new Set(
        tags
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0),
      ),
    ].slice(0, 12),
  );
}

function tokenize(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/)
    .filter((token) => token.length >= 3 && !PROMPT_STOPWORDS.has(token))
    .slice(0, 30);
}

function tokenizeToSet(text: string) {
  return new Set(tokenize(text));
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toDedupeKey(value: string) {
  return stableHash(normalizeWhitespace(value).toLowerCase());
}

function previewSummary(content: string, maxLength = 128) {
  const normalized = normalizeWhitespace(content);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function splitIntoCandidateLines(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [] as string[];
  }
  const chunks: string[] = [];
  for (const line of lines) {
    for (const sentence of line.split(/(?<=[.!?])\s+/g)) {
      const normalized = normalizeWhitespace(sentence);
      if (normalized.length > 0) {
        chunks.push(normalized);
      }
    }
  }
  return chunks;
}

function parseInlineList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  ];
}

function parseStructuredBackfillLine(line: string) {
  if (!line.toLowerCase().startsWith("[orxa_memory]")) {
    return undefined;
  }
  const readField = (key: string) => {
    const match = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
    return match?.[1]?.trim();
  };
  const workspace = readField("workspace");
  const type = readField("type");
  const tagsRaw = readField("tags") ?? "";
  const content = readField("content");
  if (!workspace || !content) {
    return undefined;
  }
  const baseType = normalizeWhitespace(type ?? "fact").toLowerCase();
  const tags = parseInlineList(tagsRaw);
  if (baseType.length > 0) {
    tags.unshift(baseType);
  }
  return {
    workspace: normalizeWorkspace(workspace),
    content: normalizeWhitespace(content),
    tags: [...new Set(tags)].slice(0, 12),
    type: baseType,
  };
}

function detectTags(content: string, actor: string) {
  const value = content.toLowerCase();
  const tags: string[] = [];
  if (actor === "user") {
    tags.push("user");
  }
  if (actor === "assistant") {
    tags.push("assistant");
  }
  if (/(prefer|like|usually|always|never|don't|do not)/i.test(value)) {
    tags.push("preference");
  }
  if (/(must|should|required|constraint|limit|blocked)/i.test(value)) {
    tags.push("constraint");
  }
  if (/(decision|decide|chose|chosen|agreed)/i.test(value)) {
    tags.push("decision");
  }
  if (/(todo|follow[- ]?up|next step|action item)/i.test(value)) {
    tags.push("follow-up");
  }
  if (/(^|[\s`])(src\/|app\/|electron\/|shared\/|package\.json|pnpm|npm|git|tsconfig|eslint)([\s`]|$)/i.test(value)) {
    tags.push("codebase");
  }
  return [...new Set(tags)];
}

function shouldCapture(mode: MemoryPolicyMode, content: string, actor: string) {
  const value = content.toLowerCase();
  if (content.length < 24 || content.length > 360) {
    return false;
  }
  if (mode === "aggressive") {
    return true;
  }
  if (mode === "codebase-facts") {
    return /(src\/|app\/|electron\/|shared\/|package\.json|pnpm|npm|eslint|tsconfig|git|command|build|lint|test|workspace|session)/i.test(value);
  }
  const strongSignal = /(prefer|always|never|don't|do not|must|should|required|decision|constraint|remember|important)/i.test(value);
  if (mode === "conservative") {
    return strongSignal;
  }
  if (strongSignal) {
    return true;
  }
  if (actor === "user" && /(need|want|goal|plan|scope|workflow)/i.test(value)) {
    return true;
  }
  if (actor === "assistant" && /(implemented|updated|added|fixed|will|next)/i.test(value)) {
    return true;
  }
  return false;
}

function confidenceFor(mode: MemoryPolicyMode, tags: string[]) {
  let score = mode === "conservative" ? 0.68 : mode === "balanced" ? 0.6 : mode === "codebase-facts" ? 0.72 : 0.52;
  if (tags.includes("constraint") || tags.includes("decision")) {
    score += 0.12;
  }
  if (tags.includes("preference")) {
    score += 0.08;
  }
  if (tags.includes("codebase")) {
    score += 0.06;
  }
  return Math.max(0.3, Math.min(0.95, Number(score.toFixed(2))));
}

const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  enabled: false,
  mode: "balanced",
  guidance:
    "Capture stable user preferences, constraints, decisions, and durable codebase facts. Skip noisy conversational filler.",
  maxPromptMemories: 6,
  maxCapturePerSession: 24,
};

const MEMORY_TEMPLATES: MemoryTemplate[] = [
  {
    id: "conservative",
    name: "Conservative",
    description: "Only store explicit durable preferences, constraints, and decisions.",
    policy: {
      enabled: true,
      mode: "conservative",
      guidance: "Capture explicit preferences, hard constraints, and confirmed decisions only.",
      maxPromptMemories: 4,
      maxCapturePerSession: 12,
    },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Store durable context while avoiding low-signal chatter.",
    policy: {
      enabled: true,
      mode: "balanced",
      guidance:
        "Capture stable user preferences, constraints, decisions, and key implementation facts. Skip transient small talk.",
      maxPromptMemories: 6,
      maxCapturePerSession: 24,
    },
  },
  {
    id: "aggressive",
    name: "Aggressive",
    description: "Store most potentially useful context and inferred patterns.",
    policy: {
      enabled: true,
      mode: "aggressive",
      guidance: "Capture broad context aggressively, including inferred patterns likely to help future sessions.",
      maxPromptMemories: 10,
      maxCapturePerSession: 40,
    },
  },
  {
    id: "codebase-facts",
    name: "Codebase Facts",
    description: "Bias towards repository paths, commands, architecture and engineering constraints.",
    policy: {
      enabled: true,
      mode: "codebase-facts",
      guidance: "Capture technical facts: paths, architecture, commands, build/test/lint flows, and tool constraints.",
      maxPromptMemories: 8,
      maxCapturePerSession: 30,
    },
  },
];

class MemorySecretStore {
  private keytarLoaded = false;
  private keytar: typeof import("keytar") | undefined;
  private fallbackSecret: string | undefined;

  private async ensureLoaded() {
    if (this.keytarLoaded) {
      return;
    }
    this.keytarLoaded = true;
    try {
      this.keytar = await import("keytar");
    } catch {
      this.keytar = undefined;
    }
  }

  async get(): Promise<string | undefined> {
    await this.ensureLoaded();
    if (this.keytar) {
      return (await this.keytar.getPassword(MEMORY_KEY_SERVICE, MEMORY_KEY_ACCOUNT)) ?? undefined;
    }
    return this.fallbackSecret;
  }

  async set(secret: string): Promise<void> {
    await this.ensureLoaded();
    if (this.keytar) {
      await this.keytar.setPassword(MEMORY_KEY_SERVICE, MEMORY_KEY_ACCOUNT, secret);
      return;
    }
    this.fallbackSecret = secret;
  }
}

export class MemoryStore {
  private db: DatabaseSync | null = null;
  private secretStore = new MemorySecretStore();
  private encryptionKey: Buffer | null = null;

  private dbPath() {
    const root = path.join(app.getPath("userData"), MEMORY_DB_DIR);
    mkdirSync(root, { recursive: true });
    return path.join(root, MEMORY_DB_FILE);
  }

  private getDb() {
    if (this.db) {
      return this.db;
    }
    const db = new DatabaseSync(this.dbPath());
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        content_enc TEXT NOT NULL,
        confidence REAL NOT NULL,
        tags_json TEXT NOT NULL,
        source_session_id TEXT,
        source_message_id TEXT,
        source_actor TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_items_workspace_updated ON memory_items(workspace, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_items_workspace_confidence ON memory_items(workspace, confidence DESC);

      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace, from_id, to_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_edges_workspace ON memory_edges(workspace);

      CREATE TABLE IF NOT EXISTS memory_tags (
        workspace TEXT NOT NULL,
        item_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(workspace, item_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_tags_workspace_tag ON memory_tags(workspace, tag);

      CREATE TABLE IF NOT EXISTS memory_policy (
        scope TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        mode TEXT NOT NULL,
        guidance_enc TEXT NOT NULL,
        max_prompt_memories INTEGER NOT NULL,
        max_capture_per_session INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_ingest_cursor (
        workspace TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.db = db;
    return db;
  }

  private async getOrCreateKey() {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }
    const existing = await this.secretStore.get();
    if (existing) {
      const parsed = Buffer.from(existing, "base64");
      if (parsed.length === 32) {
        this.encryptionKey = parsed;
        return parsed;
      }
    }
    const generated = randomBytes(32);
    await this.secretStore.set(generated.toString("base64"));
    this.encryptionKey = generated;
    return generated;
  }

  private async encrypt(value: string) {
    const key = await this.getOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
  }

  private async decrypt(payload: string) {
    const key = await this.getOrCreateKey();
    const [ivPart, tagPart, bodyPart] = payload.split(".");
    if (!ivPart || !tagPart || !bodyPart) {
      return "";
    }
    try {
      const iv = Buffer.from(ivPart, "base64");
      const tag = Buffer.from(tagPart, "base64");
      const body = Buffer.from(bodyPart, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(body), decipher.final()]);
      return plain.toString("utf8");
    } catch {
      return "";
    }
  }

  private sanitizePolicyPatch(input: Partial<MemoryPolicy>, base: MemoryPolicy): MemoryPolicy {
    const next: MemoryPolicy = {
      enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
      mode: input.mode ? normalizePolicyMode(input.mode) : base.mode,
      guidance: typeof input.guidance === "string" ? normalizeWhitespace(input.guidance).slice(0, MAX_GUIDANCE_LENGTH) : base.guidance,
      maxPromptMemories:
        typeof input.maxPromptMemories === "number"
          ? Math.max(1, Math.min(MAX_PROMPT_CONTEXT_ITEMS, Math.floor(input.maxPromptMemories)))
          : base.maxPromptMemories,
      maxCapturePerSession:
        typeof input.maxCapturePerSession === "number"
          ? Math.max(1, Math.min(MAX_CAPTURE_PER_SESSION, Math.floor(input.maxCapturePerSession)))
          : base.maxCapturePerSession,
    };
    return next;
  }

  private async ensureGlobalPolicy() {
    const db = this.getDb();
    const row = db
      .prepare("SELECT enabled, mode, guidance_enc, max_prompt_memories, max_capture_per_session, updated_at FROM memory_policy WHERE scope = ?")
      .get("global") as MemoryPolicyRow | undefined;
    if (row) {
      return;
    }
    await this.writePolicy("global", DEFAULT_MEMORY_POLICY);
  }

  private async writePolicy(scope: string, policy: MemoryPolicy) {
    const db = this.getDb();
    const guidanceEnc = await this.encrypt(policy.guidance);
    db.prepare(`
      INSERT INTO memory_policy(scope, enabled, mode, guidance_enc, max_prompt_memories, max_capture_per_session, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        enabled = excluded.enabled,
        mode = excluded.mode,
        guidance_enc = excluded.guidance_enc,
        max_prompt_memories = excluded.max_prompt_memories,
        max_capture_per_session = excluded.max_capture_per_session,
        updated_at = excluded.updated_at
    `).run(
      scope,
      policy.enabled ? 1 : 0,
      policy.mode,
      guidanceEnc,
      policy.maxPromptMemories,
      policy.maxCapturePerSession,
      now(),
    );
  }

  private async readPolicy(scope: string): Promise<MemoryPolicy | undefined> {
    const db = this.getDb();
    const row = db
      .prepare("SELECT enabled, mode, guidance_enc, max_prompt_memories, max_capture_per_session, updated_at FROM memory_policy WHERE scope = ?")
      .get(scope) as MemoryPolicyRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      enabled: row.enabled === 1,
      mode: normalizePolicyMode(row.mode),
      guidance: await this.decrypt(row.guidance_enc),
      maxPromptMemories: Math.max(1, Math.min(MAX_PROMPT_CONTEXT_ITEMS, Math.floor(row.max_prompt_memories))),
      maxCapturePerSession: Math.max(1, Math.min(MAX_CAPTURE_PER_SESSION, Math.floor(row.max_capture_per_session))),
    };
  }

  async getTemplates() {
    return MEMORY_TEMPLATES;
  }

  async getSettings(directory?: string): Promise<MemorySettings> {
    await this.ensureGlobalPolicy();
    const global = (await this.readPolicy("global")) ?? DEFAULT_MEMORY_POLICY;
    if (!directory) {
      return {
        global,
        hasWorkspaceOverride: false,
      };
    }
    const workspacePolicy = await this.readPolicy(scopeForWorkspace(directory));
    return {
      global,
      directory,
      workspace: workspacePolicy,
      hasWorkspaceOverride: Boolean(workspacePolicy),
    };
  }

  async getEffectivePolicy(directory: string): Promise<MemoryPolicy> {
    const settings = await this.getSettings(directory);
    return settings.workspace ?? settings.global;
  }

  async updateSettings(input: MemorySettingsUpdateInput): Promise<MemorySettings> {
    await this.ensureGlobalPolicy();
    const current = await this.getSettings(input.directory);
    if (input.global) {
      const nextGlobal = this.sanitizePolicyPatch(input.global, current.global);
      await this.writePolicy("global", nextGlobal);
    }

    if (input.directory) {
      const workspaceScope = scopeForWorkspace(input.directory);
      if (input.clearWorkspaceOverride) {
        this.getDb().prepare("DELETE FROM memory_policy WHERE scope = ?").run(workspaceScope);
      }
      if (input.workspace) {
        const base = current.workspace ?? current.global;
        const nextWorkspace = this.sanitizePolicyPatch(input.workspace, base);
        await this.writePolicy(workspaceScope, nextWorkspace);
      }
    }
    return this.getSettings(input.directory);
  }

  async applyTemplate(templateID: string, directory?: string, scope?: "global" | "workspace") {
    const template = MEMORY_TEMPLATES.find((item) => item.id === templateID);
    if (!template) {
      throw new Error("Unknown memory template");
    }
    const targetScope: "global" | "workspace" = scope ?? (directory ? "workspace" : "global");
    if (targetScope === "workspace") {
      if (!directory) {
        throw new Error("Workspace directory is required for workspace template apply");
      }
      return this.updateSettings({
        directory,
        workspace: template.policy,
      });
    }
    return this.updateSettings({
      global: template.policy,
      directory,
    });
  }

  async setIngestCursor(workspace: string, cursor: string) {
    this.getDb()
      .prepare(`
        INSERT INTO memory_ingest_cursor(workspace, cursor, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace) DO UPDATE SET
          cursor = excluded.cursor,
          updated_at = excluded.updated_at
      `)
      .run(normalizeWorkspace(workspace), cursor, now());
  }

  async getIngestCursor(workspace: string) {
    const row = this.getDb()
      .prepare("SELECT cursor FROM memory_ingest_cursor WHERE workspace = ?")
      .get(normalizeWorkspace(workspace)) as { cursor?: string } | undefined;
    return row?.cursor;
  }

  private extractCandidatesFromText(content: string, mode: MemoryPolicyMode, actor: string, maxCandidates: number) {
    const lines = splitIntoCandidateLines(content);
    const candidates: MemoryCandidate[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const structured = parseStructuredBackfillLine(line);
      if (structured) {
        const structuredKey = `${structured.workspace}:${toDedupeKey(structured.content)}`;
        if (seen.has(structuredKey)) {
          continue;
        }
        seen.add(structuredKey);
        const detected = detectTags(structured.content, actor);
        const tags = [...new Set([...structured.tags, ...detected])].slice(0, 12);
        candidates.push({
          workspace: structured.workspace,
          content: structured.content,
          summary: previewSummary(structured.content),
          tags,
          confidence: Math.max(0.72, confidenceFor("aggressive", tags)),
          actor,
        });
        if (candidates.length >= maxCandidates) {
          break;
        }
        continue;
      }
      if (!shouldCapture(mode, line, actor)) {
        continue;
      }
      const dedupeKey = toDedupeKey(line);
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      const tags = detectTags(line, actor);
      candidates.push({
        content: line,
        summary: previewSummary(line),
        tags,
        confidence: confidenceFor(mode, tags),
        actor,
      });
      if (candidates.length >= maxCandidates) {
        break;
      }
    }
    return candidates;
  }

  private extractCandidatesFromBundles(
    bundles: SessionMessageBundle[],
    policy: MemoryPolicy,
  ): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const seen = new Set<string>();
    for (const bundle of bundles) {
      const roleRaw = String(bundle.info.role || "").toLowerCase();
      const actor = roleRaw === "assistant" ? "assistant" : roleRaw === "user" ? "user" : "system";
      for (const part of bundle.parts) {
        if (part.type !== "text") {
          continue;
        }
        const text = typeof part.text === "string" ? part.text : "";
        if (!text.trim()) {
          continue;
        }
        const perPart = this.extractCandidatesFromText(text, policy.mode, actor, Math.max(3, Math.ceil(policy.maxCapturePerSession / 8)));
        for (const candidate of perPart) {
          const key = `${candidate.summary}:${candidate.content.toLowerCase()}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          candidate.messageID = bundle.info.id;
          candidate.actor = actor;
          candidates.push(candidate);
          if (candidates.length >= policy.maxCapturePerSession) {
            return candidates;
          }
        }
      }
      if (candidates.length >= policy.maxCapturePerSession) {
        break;
      }
    }
    return candidates.slice(0, policy.maxCapturePerSession);
  }

  private syncTags(workspace: string, itemID: string, tags: string[]) {
    const db = this.getDb();
    db.prepare("DELETE FROM memory_tags WHERE workspace = ? AND item_id = ?").run(workspace, itemID);
    const insert = db.prepare("INSERT INTO memory_tags(workspace, item_id, tag) VALUES (?, ?, ?)");
    for (const tag of [...new Set(tags)].slice(0, 12)) {
      insert.run(workspace, itemID, tag);
    }
  }

  private async upsertMemoryItem(input: {
    workspace: string;
    sessionID: string;
    candidate: MemoryCandidate;
  }) {
    const { workspace, sessionID, candidate } = input;
    const db = this.getDb();
    const dedupeKey = toDedupeKey(candidate.content);
    const contentEnc = await this.encrypt(candidate.content);
    const tagsJson = serializeTags(candidate.tags);
    const existing = db
      .prepare("SELECT id FROM memory_items WHERE workspace = ? AND dedupe_key = ?")
      .get(workspace, dedupeKey) as { id?: string } | undefined;
    const timestamp = now();
    if (existing?.id) {
      db.prepare(`
        UPDATE memory_items
        SET summary = ?, content_enc = ?, confidence = ?, tags_json = ?, source_session_id = ?, source_message_id = ?, source_actor = ?, updated_at = ?
        WHERE id = ?
      `).run(
        candidate.summary,
        contentEnc,
        candidate.confidence,
        tagsJson,
        sessionID,
        candidate.messageID ?? null,
        candidate.actor ?? null,
        timestamp,
        existing.id,
      );
      this.syncTags(workspace, existing.id, candidate.tags);
      return { id: existing.id, inserted: false };
    }
    const id = `mem_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    db.prepare(`
      INSERT INTO memory_items(
        id, workspace, dedupe_key, summary, content_enc, confidence, tags_json,
        source_session_id, source_message_id, source_actor, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workspace,
      dedupeKey,
      candidate.summary,
      contentEnc,
      candidate.confidence,
      tagsJson,
      sessionID,
      candidate.messageID ?? null,
      candidate.actor ?? null,
      timestamp,
      timestamp,
    );
    this.syncTags(workspace, id, candidate.tags);
    return { id, inserted: true };
  }

  private upsertEdge(workspace: string, fromID: string, toID: string, relation: string, weight = 1) {
    if (fromID === toID) {
      return;
    }
    const from = fromID < toID ? fromID : toID;
    const to = fromID < toID ? toID : fromID;
    const id = `edge_${stableHash(`${workspace}:${from}:${to}:${relation}`).slice(0, 20)}`;
    const timestamp = now();
    this.getDb()
      .prepare(`
        INSERT INTO memory_edges(id, workspace, from_id, to_id, relation, weight, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace, from_id, to_id, relation) DO UPDATE SET
          weight = MIN(5.0, memory_edges.weight + excluded.weight),
          updated_at = excluded.updated_at
      `)
      .run(id, workspace, from, to, relation, weight, timestamp, timestamp);
  }

  async ingestSessionMessages(
    workspaceInput: string,
    sessionID: string,
    bundles: SessionMessageBundle[],
    options?: { workspaceAllowlist?: string[] },
  ): Promise<MemoryIngestStats> {
    const workspace = normalizeWorkspace(workspaceInput);
    const policy = await this.getEffectivePolicy(workspace);
    if (!policy.enabled || bundles.length === 0) {
      return { inserted: 0, updated: 0 };
    }
    const allowlist = new Set(
      (options?.workspaceAllowlist ?? [])
        .map((item) => normalizeWorkspace(item))
        .filter((item) => item.length > 0),
    );
    const candidates = this.extractCandidatesFromBundles(bundles, policy);
    const touchedItemIDs: Array<{ id: string; tags: string[]; workspace: string }> = [];
    const stats: MemoryIngestStats = { inserted: 0, updated: 0 };
    for (const candidate of candidates) {
      const candidateWorkspaceRaw = candidate.workspace ? normalizeWorkspace(candidate.workspace) : workspace;
      const candidateWorkspace =
        allowlist.size === 0 || allowlist.has(candidateWorkspaceRaw) ? candidateWorkspaceRaw : workspace;
      const result = await this.upsertMemoryItem({
        workspace: candidateWorkspace,
        sessionID,
        candidate,
      });
      touchedItemIDs.push({ id: result.id, tags: candidate.tags, workspace: candidateWorkspace });
      if (result.inserted) {
        stats.inserted += 1;
      } else {
        stats.updated += 1;
      }
      const recent = touchedItemIDs.slice(-4);
      const current = recent[recent.length - 1];
      if (!current) {
        continue;
      }
      for (const previous of recent.slice(0, -1)) {
        if (previous.workspace !== current.workspace) {
          continue;
        }
        const hasTagOverlap = previous.tags.some((tag) => current.tags.includes(tag));
        this.upsertEdge(current.workspace, previous.id, current.id, hasTagOverlap ? "shared-tag" : "related", hasTagOverlap ? 1.2 : 0.7);
      }
    }
    return stats;
  }

  private scorePromptCandidate(tokens: string[], summary: string, tags: string[], content: string, confidence: number) {
    const summaryTokens = tokenizeToSet(summary);
    const tagTokens = tokenizeToSet(tags.join(" "));
    const contentTokens = tokenizeToSet(content);
    const matchedTokens = new Set<string>();
    let score = confidence;
    for (const token of tokens) {
      if (summaryTokens.has(token)) {
        matchedTokens.add(token);
        score += 0.9;
      }
      if (tagTokens.has(token)) {
        matchedTokens.add(token);
        score += 0.7;
      }
      if (contentTokens.has(token)) {
        matchedTokens.add(token);
        score += 0.5;
      }
    }
    return {
      score,
      matchedCount: matchedTokens.size,
      ratio: tokens.length === 0 ? 0 : matchedTokens.size / tokens.length,
      scoreBoost: score - confidence,
    };
  }

  async getPromptMemories(workspaceInput: string, query: string, limit: number): Promise<MemoryPromptEntry[]> {
    const workspace = normalizeWorkspace(workspaceInput);
    const db = this.getDb();
    const rows = db
      .prepare(`
        SELECT id, summary, content_enc, confidence, tags_json, updated_at
        FROM memory_items
        WHERE workspace = ?
        ORDER BY updated_at DESC
        LIMIT 240
      `)
      .all(workspace) as Array<{
      id: string;
      summary: string;
      content_enc: string;
      confidence: number;
      tags_json: string;
      updated_at: number;
    }>;
    const tokens = tokenize(query);
    if (tokens.length === 0) {
      return [];
    }
    const scored: Array<{ score: number; entry: MemoryPromptEntry }> = [];
    for (const row of rows) {
      const tags = parseTags(row.tags_json);
      const content = await this.decrypt(row.content_enc);
      const candidate = this.scorePromptCandidate(tokens, row.summary, tags, content, row.confidence);
      const minMatchedCount = tokens.length >= 6 ? 2 : 1;
      const minRatio = tokens.length >= 8 ? 0.22 : tokens.length >= 4 ? 0.18 : 0.1;
      const minScoreBoost = tokens.length >= 8 ? 1.6 : tokens.length >= 5 ? 1.1 : 0.7;
      if (candidate.matchedCount < minMatchedCount || candidate.ratio < minRatio || candidate.scoreBoost < minScoreBoost) {
        continue;
      }
      scored.push({
        score: candidate.score,
        entry: {
          summary: row.summary,
          content,
          confidence: row.confidence,
          tags,
        },
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, Math.min(MAX_PROMPT_CONTEXT_ITEMS, limit))).map((item) => item.entry);
  }

  async buildPromptContext(workspace: string, query: string) {
    const policy = await this.getEffectivePolicy(workspace);
    if (!policy.enabled) {
      return "";
    }
    const entries = await this.getPromptMemories(workspace, query, policy.maxPromptMemories);
    if (entries.length === 0) {
      return policy.guidance.trim().length > 0 ? `Workspace memory guidance:\n${policy.guidance}` : "";
    }
    const lines = [
      "Workspace memory guidance:",
      policy.guidance,
      "",
      "Relevant workspace memories:",
    ];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const detail = previewSummary(entry.content, 240);
      const tags = entry.tags.length > 0 ? `tags: ${entry.tags.join(", ")}` : "tags: none";
      lines.push(`${index + 1}. (${tags}; confidence ${entry.confidence.toFixed(2)}) ${entry.summary}`);
      lines.push(`   detail: ${detail}`);
    }
    return lines.join("\n").trim();
  }

  private async toNode(row: MemoryItemRow): Promise<MemoryNode> {
    return {
      id: row.id,
      workspace: row.workspace,
      summary: row.summary,
      content: await this.decrypt(row.content_enc),
      confidence: row.confidence,
      tags: parseTags(row.tags_json),
      source: {
        sessionID: row.source_session_id ?? undefined,
        messageID: row.source_message_id ?? undefined,
        actor: row.source_actor ?? undefined,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getGraph(input?: MemoryGraphQuery): Promise<MemoryGraphSnapshot> {
    const workspace = input?.workspace ? normalizeWorkspace(input.workspace) : undefined;
    const query = normalizeWhitespace(input?.query ?? "");
    const relationFilter = normalizeWhitespace(input?.relation ?? "").toLowerCase();
    const nodeLimit = Math.max(1, Math.min(MAX_GRAPH_NODES, Math.floor(input?.limit ?? MAX_GRAPH_NODES)));
    const db = this.getDb();
    const rows = workspace
      ? (db
          .prepare(`
            SELECT id, workspace, summary, content_enc, confidence, tags_json, source_session_id, source_message_id, source_actor, created_at, updated_at
            FROM memory_items
            WHERE workspace = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `)
          .all(workspace, nodeLimit) as MemoryItemRow[])
      : (db
          .prepare(`
            SELECT id, workspace, summary, content_enc, confidence, tags_json, source_session_id, source_message_id, source_actor, created_at, updated_at
            FROM memory_items
            ORDER BY updated_at DESC
            LIMIT ?
          `)
          .all(nodeLimit) as MemoryItemRow[]);
    const nodes: MemoryNode[] = [];
    const queryTokens = tokenize(query);
    for (const row of rows) {
      const node = await this.toNode(row);
      if (queryTokens.length > 0) {
        const blob = `${node.summary} ${node.content} ${node.tags.join(" ")}`.toLowerCase();
        if (!queryTokens.some((token) => blob.includes(token))) {
          continue;
        }
      }
      nodes.push(node);
    }
    const nodeIDs = new Set(nodes.map((node) => node.id));
    const edgeRows = workspace
      ? (db
          .prepare(`
            SELECT id, workspace, from_id, to_id, relation, weight, created_at, updated_at
            FROM memory_edges
            WHERE workspace = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `)
          .all(workspace, MAX_GRAPH_EDGES) as Array<{
          id: string;
          workspace: string;
          from_id: string;
          to_id: string;
          relation: string;
          weight: number;
          created_at: number;
          updated_at: number;
        }>)
      : (db
          .prepare(`
            SELECT id, workspace, from_id, to_id, relation, weight, created_at, updated_at
            FROM memory_edges
            ORDER BY updated_at DESC
            LIMIT ?
          `)
          .all(MAX_GRAPH_EDGES) as Array<{
          id: string;
          workspace: string;
          from_id: string;
          to_id: string;
          relation: string;
          weight: number;
          created_at: number;
          updated_at: number;
        }>);
    const edges: MemoryEdge[] = edgeRows
      .filter((row) => nodeIDs.has(row.from_id) && nodeIDs.has(row.to_id))
      .filter((row) => !relationFilter || row.relation.toLowerCase().includes(relationFilter))
      .map((row) => ({
        id: row.id,
        workspace: row.workspace,
        from: row.from_id,
        to: row.to_id,
        relation: row.relation,
        weight: row.weight,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    const workspaceSet = new Set<string>(nodes.map((node) => node.workspace));
    return {
      nodes,
      edges,
      workspaces: [...workspaceSet].sort((a, b) => a.localeCompare(b)),
      updatedAt: now(),
    };
  }

  async clearWorkspace(workspaceInput: string) {
    const workspace = normalizeWorkspace(workspaceInput);
    const db = this.getDb();
    db.prepare("DELETE FROM memory_edges WHERE workspace = ?").run(workspace);
    db.prepare("DELETE FROM memory_tags WHERE workspace = ?").run(workspace);
    db.prepare("DELETE FROM memory_items WHERE workspace = ?").run(workspace);
    db.prepare("DELETE FROM memory_ingest_cursor WHERE workspace = ?").run(workspace);
    return true;
  }
}

export type { MemoryIngestStats };
