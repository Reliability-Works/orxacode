import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import ignore from "ignore";
import type {
  GitCommitRequest,
  KanbanAutomation,
  KanbanBoardSnapshot,
  KanbanCheckpointDiff,
  KanbanColumnId,
  KanbanCreateAutomationInput,
  KanbanCreateWorktreeInput,
  KanbanCreateTaskInput,
  KanbanDiffFile,
  KanbanGitCommitEntry,
  KanbanGitState,
  KanbanLegacyImportInput,
  KanbanMergeStatus,
  KanbanManagementOperation,
  KanbanManagementPromptResult,
  KanbanManagementSession,
  KanbanRuntimeStatus,
  KanbanMoveTaskInput,
  KanbanProvider,
  KanbanReviewComment,
  KanbanRun,
  KanbanRunLogItem,
  KanbanSchedule,
  KanbanScriptShortcutResult,
  KanbanSettings,
  KanbanTaskCheckpoint,
  KanbanTask,
  KanbanTaskActivityKind,
  KanbanTaskDependency,
  KanbanTaskDetail,
  KanbanTaskRuntime,
  KanbanTaskStatusSummary,
  KanbanTaskTerminal,
  KanbanTaskTrashStatus,
  KanbanUpdateAutomationInput,
  KanbanUpdateSettingsInput,
  KanbanUpdateTaskInput,
  KanbanWorktree,
  KanbanWorktreeStatusDetail,
  KanbanWorkspace,
  OrxaEvent,
  SessionMessageBundle,
} from "../../shared/ipc";
import type { OpencodeService } from "./opencode-service";
import type { CodexService } from "./codex-service";
import type { ClaudeChatService } from "./claude-chat-service";
import type { OrxaTerminalService } from "./orxa-terminal-service";
import { getPersistenceDatabasePath } from "./persistence-service";
import { OpencodeCommandHelpers } from "./opencode-command-helpers";
import { sanitizeError } from "./opencode-runtime-helpers";
import { parseUnifiedDiff } from "./kanban-diff";
import { buildKanbanManagementPrompt, parseKanbanManagementResponse } from "./kanban-management";

type PersistenceDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
};

const require = createRequire(import.meta.url);

function createDatabase(databasePath: string): PersistenceDatabase {
  try {
    const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
    return new BetterSqlite3(databasePath);
  } catch (error) {
    if (process.versions.electron) {
      throw error;
    }
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSync(databasePath);
  }
}

function tableColumns(database: PersistenceDatabase, table: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  return new Set(rows.map((row) => asString(row.name)).filter(Boolean));
}

function ensureColumn(database: PersistenceDatabase, table: string, column: string, definition: string) {
  const columns = tableColumns(database, table);
  if (!columns.has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function defaultKanbanSettings(workspaceDir: string): KanbanSettings {
  return {
    workspaceDir,
    autoCommit: false,
    autoPr: false,
    defaultProvider: "opencode",
    providerDefaults: {},
    scriptShortcuts: [],
    worktreeInclude: {
      filePath: path.join(workspaceDir, ".worktreeinclude"),
      detected: false,
      source: "none",
      entries: [],
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

function summarizeSessionBundles(messages: SessionMessageBundle[]) {
  return messages.map((bundle, index) => {
    const content = bundle.parts
      .map((part) => {
        const record = part as Record<string, unknown>;
        return asString(record.text ?? record.content).trim();
      })
      .filter((part) => part.length > 0)
      .join("\n\n")
      || asString((bundle.info as Record<string, unknown>).summary).trim()
      || "(no content)";
    return {
      id: asString((bundle.info as Record<string, unknown>).id) || `bundle-${index}`,
      role: (((bundle.info as Record<string, unknown>).role) === "user" ? "user" : "assistant") as "user" | "assistant",
      content,
      timestamp: Number(asRecord((bundle.info as Record<string, unknown>).time)?.createdAt ?? Date.now()) || Date.now(),
    };
  });
}

const KANBAN_MANAGED_EXCLUDE_BLOCK_START = "# orxa-kanban-managed-ignored-paths:start";
const KANBAN_MANAGED_EXCLUDE_BLOCK_END = "# orxa-kanban-managed-ignored-paths:end";
const TASK_PATCH_FILE_SUFFIX = ".patch";
const SYMLINK_PATH_SEGMENT_BLACKLIST = new Set([
  ".git",
  ".DS_Store",
  "Thumbs.db",
  "Desktop.ini",
  "Icon\r",
  ".Spotlight-V100",
  ".Trashes",
]);

class TaskWorktreeService {
  private readonly commands = new OpencodeCommandHelpers();
  private readonly patchesRootPath: string;
  static readonly WORKTREE_INCLUDE_NAME = ".worktreeinclude";

  constructor(options: { patchesRootPath: string }) {
    this.patchesRootPath = options.patchesRootPath;
  }

  private toPlatformRelativePath(value: string) {
    return value
      .trim()
      .replaceAll("\\", "/")
      .replace(/\/+$/g, "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .join("/");
  }

  private taskPatchPrefix(taskId: string) {
    return `${slugify(taskId)}.`;
  }

  private parseTaskPatchCommit(taskId: string, filename: string) {
    const prefix = this.taskPatchPrefix(taskId);
    if (!filename.startsWith(prefix) || !filename.endsWith(TASK_PATCH_FILE_SUFFIX)) {
      return null;
    }
    const commit = filename.slice(prefix.length, -TASK_PATCH_FILE_SUFFIX.length).trim();
    return commit.length > 0 ? commit : null;
  }

  private async runGitRaw(repoPath: string, args: string[], cwd = repoPath) {
    const gitEnv = { ...process.env } as NodeJS.ProcessEnv;
    delete gitEnv.GIT_DIR;
    delete gitEnv.GIT_WORK_TREE;
    delete gitEnv.GIT_COMMON_DIR;
    delete gitEnv.GIT_INDEX_FILE;

    return new Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
      const child = spawn("git", ["-C", repoPath, ...args], {
        cwd,
        env: {
          ...gitEnv,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: string[] = [];
      const stderr: string[] = [];
      child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
      child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
      child.on("error", (error) => {
        resolve({ ok: false, stdout: "", stderr: sanitizeError(error), exitCode: null });
      });
      child.on("close", (code) => {
        resolve({ ok: code === 0, stdout: stdout.join(""), stderr: stderr.join(""), exitCode: code });
      });
    });
  }

  private async getGitStdout(repoPath: string, args: string[], cwd = repoPath) {
    const result = await this.runGitRaw(repoPath, args, cwd);
    if (!result.ok) {
      const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`git ${args.join(" ")} failed${details ? `: ${details}` : ""}`);
    }
    return result.stdout.trim();
  }

  private async resolveRepoRoot(directory: string) {
    return this.getGitStdout(directory, ["rev-parse", "--show-toplevel"], directory);
  }

  private async currentBranch(repoRoot: string) {
    const output = await this.getGitStdout(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
    return output || "HEAD";
  }

  private taskPatchFiles(taskId: string) {
    if (!existsSync(this.patchesRootPath)) {
      return [] as string[];
    }
    return readdirSync(this.patchesRootPath)
      .filter((entry: string) => this.parseTaskPatchCommit(taskId, entry) !== null) as string[];
  }

  private deleteTaskPatchFiles(taskId: string) {
    for (const filename of this.taskPatchFiles(taskId)) {
      rmSync(path.join(this.patchesRootPath, filename), { force: true });
    }
  }

  private findTaskPatch(taskId: string) {
    const filename = this.taskPatchFiles(taskId).sort().at(-1);
    if (!filename) {
      return null;
    }
    const commit = this.parseTaskPatchCommit(taskId, filename);
    if (!commit) {
      return null;
    }
    return {
      path: path.join(this.patchesRootPath, filename),
      commit,
    };
  }

  private escapeGitIgnoreLiteral(relativePath: string) {
    return this.toPlatformRelativePath(relativePath)
      .replace(/\\/g, "\\\\")
      .replace(/^([#!])/u, "\\$1")
      .replace(/([*?[])/g, "\\$1");
  }

  private stripManagedExcludeBlock(content: string) {
    const lines = content.split("\n");
    const nextLines: string[] = [];
    let insideManagedBlock = false;
    for (const line of lines) {
      if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_START) {
        insideManagedBlock = true;
        continue;
      }
      if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_END) {
        insideManagedBlock = false;
        continue;
      }
      if (!insideManagedBlock) {
        nextLines.push(line);
      }
    }
    return nextLines.join("\n").replace(/\n+$/g, "");
  }

  private getUniquePaths(relativePaths: string[]) {
    const uniquePaths = Array.from(new Set(relativePaths.map((value) => this.toPlatformRelativePath(value)).filter(Boolean)));
    uniquePaths.sort((left, right) => {
      const leftDepth = left.split("/").length;
      const rightDepth = right.split("/").length;
      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth;
      }
      return left.localeCompare(right);
    });

    const roots: string[] = [];
    for (const candidate of uniquePaths) {
      if (roots.some((root) => candidate === root || candidate.startsWith(`${root}/`))) {
        continue;
      }
      roots.push(candidate);
    }
    return roots;
  }

  private shouldSkipSymlink(relativePath: string) {
    const segments = relativePath.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return true;
    }
    return segments.some((segment) => SYMLINK_PATH_SEGMENT_BLACKLIST.has(segment));
  }

  private async listIgnoredPaths(repoRoot: string) {
    const output = await this.getGitStdout(
      repoRoot,
      ["ls-files", "--others", "--ignored", "--exclude-per-directory=.gitignore", "--directory"],
      repoRoot,
    );
    return output
      .split(/\r?\n/)
      .map((line) => this.toPlatformRelativePath(line))
      .filter((line) => line.length > 0);
  }

  private async listUntrackedPaths(worktreePath: string) {
    const output = await this.getGitStdout(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"], worktreePath).catch(() => "");
    return output
      .split("\0")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private resolveIncludedIgnoredPaths(ignoredPaths: string[], patterns: string[]) {
    const normalizedPatterns = patterns
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith("#"));
    if (normalizedPatterns.length === 0) {
      return [] as string[];
    }
    const matcher = ignore().add(normalizedPatterns);
    return this.getUniquePaths(
      ignoredPaths.filter((relativePath) => matcher.ignores(relativePath) || matcher.ignores(`${relativePath}/`)),
    ).filter((relativePath) => !this.shouldSkipSymlink(relativePath));
  }

  private async syncManagedIgnoredPathExcludes(worktreePath: string, relativePaths: string[]) {
    const excludePathOutput = await this.getGitStdout(worktreePath, ["rev-parse", "--git-path", "info/exclude"], worktreePath);
    const excludePath = path.isAbsolute(excludePathOutput)
      ? excludePathOutput
      : path.join(worktreePath, excludePathOutput);

    const existingContent = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    const preservedContent = this.stripManagedExcludeBlock(existingContent);
    const managedBlock = relativePaths.length === 0
      ? ""
      : [
        KANBAN_MANAGED_EXCLUDE_BLOCK_START,
        "# Keep symlinked ignored paths ignored inside Orxa Kanban worktrees.",
        ...relativePaths.map((relativePath) => `/${this.escapeGitIgnoreLiteral(relativePath)}`),
        KANBAN_MANAGED_EXCLUDE_BLOCK_END,
      ].join("\n");

    const nextContent = [preservedContent, managedBlock].filter(Boolean).join("\n\n").replace(/\n+$/g, "");
    const normalizedNextContent = nextContent ? `${nextContent}\n` : "";
    if (normalizedNextContent === existingContent) {
      return;
    }
    mkdirSync(path.dirname(excludePath), { recursive: true });
    writeFileSync(excludePath, normalizedNextContent, "utf8");
  }

  private async syncIgnoredPathsIntoWorktree(repoRoot: string, worktreePath: string, patterns: string[]) {
    const mirroredIgnoredPaths = this.resolveIncludedIgnoredPaths(await this.listIgnoredPaths(repoRoot), patterns);
    await this.syncManagedIgnoredPathExcludes(worktreePath, mirroredIgnoredPaths);

    for (const relativePath of mirroredIgnoredPaths) {
      const sourcePath = path.join(repoRoot, relativePath);
      if (!existsSync(sourcePath)) {
        continue;
      }
      const targetPath = path.join(worktreePath, relativePath);
      if (existsSync(targetPath)) {
        continue;
      }
      const sourceStats = lstatSync(sourcePath);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      try {
        symlinkSync(sourcePath, targetPath, sourceStats.isDirectory() ? "dir" : "file");
      } catch {
        rmSync(targetPath, { recursive: true, force: true });
      }
    }
  }

  private async captureTaskPatch(task: KanbanTask) {
    const worktreePath = task.worktreePath?.trim();
    if (!worktreePath || !existsSync(worktreePath)) {
      this.deleteTaskPatchFiles(task.id);
      return;
    }
    const headCommit = await this.getGitStdout(worktreePath, ["rev-parse", "--verify", "HEAD"], worktreePath);
    const trackedPatch = await this.getGitStdout(worktreePath, ["diff", "--binary", "HEAD", "--"], worktreePath).catch(() => "");
    const patchChunks = trackedPatch.trim().length > 0 ? [trackedPatch.endsWith("\n") ? trackedPatch : `${trackedPatch}\n`] : [];

    for (const relativePath of await this.listUntrackedPaths(worktreePath)) {
      const result = await this.runGitRaw(worktreePath, ["diff", "--binary", "--no-index", "--", "/dev/null", relativePath], worktreePath);
      if (!result.ok && result.exitCode !== 1) {
        throw new Error(result.stderr || result.stdout || `Failed to capture patch for ${relativePath}`);
      }
      if (result.stdout.trim().length > 0) {
        patchChunks.push(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
      }
    }

    this.deleteTaskPatchFiles(task.id);
    if (patchChunks.length === 0) {
      return;
    }

    mkdirSync(this.patchesRootPath, { recursive: true });
    const patchPath = path.join(this.patchesRootPath, `${slugify(task.id)}.${headCommit}${TASK_PATCH_FILE_SUFFIX}`);
    writeFileSync(patchPath, patchChunks.join(""), "utf8");
  }

  readWorktreeInclude(repoRoot: string) {
    const filePath = path.join(repoRoot, TaskWorktreeService.WORKTREE_INCLUDE_NAME);
    if (!existsSync(filePath)) {
      return {
        filePath,
        detected: false,
        source: "none" as const,
        entries: [] as string[],
        updatedAt: Date.now(),
      };
    }
    const entries = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    return {
      filePath,
      detected: true,
      source: "worktreeinclude" as const,
      entries,
      updatedAt: Date.now(),
    };
  }

  createWorktreeIncludeFromGitignore(repoRoot: string) {
    const gitignorePath = path.join(repoRoot, ".gitignore");
    const filePath = path.join(repoRoot, TaskWorktreeService.WORKTREE_INCLUDE_NAME);
    const entries = existsSync(gitignorePath)
      ? readFileSync(gitignorePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
      : [];
    writeFileSync(filePath, `${entries.join("\n")}${entries.length ? "\n" : ""}`, "utf8");
    return {
      filePath,
      detected: true,
      source: "generated_from_gitignore" as const,
      entries,
      updatedAt: Date.now(),
    };
  }

  async ensure(task: KanbanTask, worktreeIncludeEntries: string[] = []) {
    const repoRoot = await this.resolveRepoRoot(task.workspaceDir);
    const baseRef = task.baseRef?.trim() || await this.currentBranch(repoRoot) || "HEAD";
    const branch = task.taskBranch?.trim() || `kanban/${slugify(task.title)}-${task.id.slice(0, 6)}`;
    const root = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-orxa-kanban`);
    mkdirSync(root, { recursive: true });
    const worktreePath = task.worktreePath?.trim() || path.join(root, branch.replace(/[\\/]/g, "__"));

    if (!existsSync(worktreePath)) {
      const storedPatch = this.findTaskPatch(task.id);
      const preferredRef = storedPatch?.commit || baseRef;
      try {
        const branchExists = await this.runGitRaw(repoRoot, ["rev-parse", "--verify", `${branch}^{commit}`], repoRoot);
        if (branchExists.ok) {
          if (storedPatch) {
            await this.getGitStdout(repoRoot, ["branch", "-f", branch, preferredRef], repoRoot);
          }
          await this.getGitStdout(repoRoot, ["worktree", "add", worktreePath, branch], repoRoot);
        } else {
          await this.getGitStdout(repoRoot, ["worktree", "add", "-b", branch, worktreePath, preferredRef], repoRoot);
        }
      } catch (error) {
        if (!storedPatch) {
          throw error;
        }
        const branchExists = await this.runGitRaw(repoRoot, ["rev-parse", "--verify", `${branch}^{commit}`], repoRoot);
        if (branchExists.ok) {
          await this.getGitStdout(repoRoot, ["branch", "-f", branch, baseRef], repoRoot);
          await this.getGitStdout(repoRoot, ["worktree", "add", worktreePath, branch], repoRoot);
        } else {
          await this.getGitStdout(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);
        }
      }

      if (storedPatch && existsSync(storedPatch.path)) {
        const applyResult = await this.runGitRaw(worktreePath, ["apply", "--binary", "--whitespace=nowarn", storedPatch.path], worktreePath);
        if (applyResult.ok) {
          rmSync(storedPatch.path, { force: true });
        }
      }
    }

    await this.syncIgnoredPathsIntoWorktree(repoRoot, worktreePath, worktreeIncludeEntries);
    return { repoRoot, worktreePath, branch, baseRef };
  }

  async createStandalone(workspaceDir: string, label: string, baseRef?: string) {
    const repoRoot = await this.resolveRepoRoot(workspaceDir);
    const resolvedBaseRef = baseRef?.trim() || await this.currentBranch(repoRoot) || "HEAD";
    const branch = `kanban/${slugify(label)}-${randomUUID().slice(0, 6)}`;
    const root = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-orxa-kanban`);
    mkdirSync(root, { recursive: true });
    const worktreePath = path.join(root, branch.replace(/[\\/]/g, "__"));
    await this.getGitStdout(repoRoot, ["worktree", "add", "-b", branch, worktreePath, resolvedBaseRef], repoRoot);
    const include = this.readWorktreeInclude(repoRoot);
    await this.syncIgnoredPathsIntoWorktree(repoRoot, worktreePath, include.entries);
    return { repoRoot, worktreePath, branch, baseRef: resolvedBaseRef };
  }

  async cleanup(task: KanbanTask, options?: { preservePatch?: boolean }) {
    const worktreePath = task.worktreePath?.trim();
    if (!worktreePath || !existsSync(worktreePath)) {
      if (options?.preservePatch === false) {
        this.deleteTaskPatchFiles(task.id);
      }
      return;
    }
    const repoRoot = await this.resolveRepoRoot(task.workspaceDir).catch(() => task.workspaceDir);
    if (options?.preservePatch !== false) {
      await this.captureTaskPatch(task).catch(() => undefined);
    } else {
      this.deleteTaskPatchFiles(task.id);
    }
    await this.commands.runCommand("git", ["-C", repoRoot, "worktree", "remove", "--force", worktreePath], repoRoot).catch(() => undefined);
    rmSync(worktreePath, { recursive: true, force: true });
  }
}

type KanbanServiceDeps = {
  opencodeService: OpencodeService;
  codexService: CodexService;
  claudeChatService: ClaudeChatService;
  terminalService: OrxaTerminalService;
  databasePath?: string;
};

export class KanbanService extends EventEmitter {
  private readonly database: PersistenceDatabase;
  private readonly worktrees: TaskWorktreeService;
  private readonly opencodeService: OpencodeService;
  private readonly codexService: CodexService;
  private readonly claudeChatService: ClaudeChatService;
  private readonly terminalService: OrxaTerminalService;
  private readonly commands = new OpencodeCommandHelpers();
  private readonly schedulerTimer: ReturnType<typeof setInterval>;
  private schedulerRunning = false;
  onEvent?: (event: OrxaEvent) => void;

  constructor({ opencodeService, codexService, claudeChatService, terminalService, databasePath }: KanbanServiceDeps) {
    super();
    const resolvedPath = databasePath ?? getPersistenceDatabasePath();
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.database = createDatabase(resolvedPath);
    this.worktrees = new TaskWorktreeService({
      patchesRootPath: path.join(path.dirname(resolvedPath), "kanban-trashed-task-patches"),
    });
    this.opencodeService = opencodeService;
    this.codexService = codexService;
    this.claudeChatService = claudeChatService;
    this.terminalService = terminalService;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS kanban_workspaces (
        workspace_dir TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kanban_boards (
        workspace_dir TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kanban_tasks (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        description TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_config_json TEXT NOT NULL DEFAULT '{}',
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        status_summary TEXT NOT NULL,
        worktree_path TEXT,
        base_ref TEXT,
        task_branch TEXT,
        provider_session_key TEXT,
        provider_thread_id TEXT,
        latest_run_id TEXT,
        auto_start_when_unblocked INTEGER NOT NULL,
        ship_status TEXT,
        trash_status TEXT NOT NULL DEFAULT 'active',
        restore_column_id TEXT,
        latest_preview TEXT,
        latest_activity_kind TEXT,
        merge_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        trashed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_tasks_workspace_position
        ON kanban_tasks(workspace_dir, column_id, position, updated_at DESC);
      CREATE TABLE IF NOT EXISTS kanban_task_dependencies (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        from_task_id TEXT NOT NULL,
        to_task_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_task_dependencies_unique
        ON kanban_task_dependencies(workspace_dir, from_task_id, to_task_id);
      CREATE TABLE IF NOT EXISTS kanban_runs (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        task_id TEXT,
        automation_id TEXT,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        session_key TEXT,
        provider_thread_id TEXT,
        ship_status TEXT,
        error TEXT,
        logs_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_runs_workspace_updated
        ON kanban_runs(workspace_dir, updated_at DESC);
      CREATE TABLE IF NOT EXISTS kanban_automations (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        provider TEXT NOT NULL,
        browser_mode_enabled INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        auto_start INTEGER NOT NULL,
        schedule_json TEXT NOT NULL,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kanban_review_comments (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kanban_settings (
        workspace_dir TEXT PRIMARY KEY,
        auto_commit INTEGER NOT NULL,
        auto_pr INTEGER NOT NULL,
        default_provider TEXT NOT NULL,
        provider_defaults_json TEXT NOT NULL DEFAULT '{}',
        script_shortcuts_json TEXT NOT NULL,
        worktree_include_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kanban_task_runtime (
        task_id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        resume_token TEXT,
        terminal_id TEXT,
        worktree_path TEXT,
        base_ref TEXT,
        task_branch TEXT,
        last_event_summary TEXT,
        latest_preview TEXT,
        latest_activity_kind TEXT,
        merge_status TEXT,
        trash_status TEXT NOT NULL DEFAULT 'active',
        checkpoint_cursor TEXT,
        last_checkpoint_id TEXT,
        updated_at INTEGER NOT NULL,
        trashed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS kanban_task_checkpoints (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT,
        label TEXT NOT NULL,
        source TEXT NOT NULL,
        session_key TEXT,
        provider_thread_id TEXT,
        git_revision TEXT,
        diff_raw TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_task_checkpoints_task
        ON kanban_task_checkpoints(workspace_dir, task_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS kanban_management_sessions (
        workspace_dir TEXT NOT NULL,
        provider TEXT NOT NULL,
        session_key TEXT NOT NULL,
        provider_thread_id TEXT,
        status TEXT NOT NULL,
        transcript_json TEXT NOT NULL,
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_dir, provider)
      );
      CREATE TABLE IF NOT EXISTS kanban_worktrees (
        id TEXT PRIMARY KEY,
        workspace_dir TEXT NOT NULL,
        task_id TEXT,
        label TEXT NOT NULL,
        provider TEXT,
        repo_root TEXT NOT NULL,
        directory TEXT NOT NULL,
        branch TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        merge_status TEXT NOT NULL,
        latest_preview TEXT,
        latest_activity_kind TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        trashed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_worktrees_workspace_updated
        ON kanban_worktrees(workspace_dir, updated_at DESC);
    `);
    this.migrateLegacyKanbanSchema();
    ensureColumn(this.database, "kanban_tasks", "trash_status", "TEXT NOT NULL DEFAULT 'active'");
    ensureColumn(this.database, "kanban_tasks", "provider_config_json", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(this.database, "kanban_tasks", "restore_column_id", "TEXT");
    ensureColumn(this.database, "kanban_tasks", "latest_preview", "TEXT");
    ensureColumn(this.database, "kanban_tasks", "latest_activity_kind", "TEXT");
    ensureColumn(this.database, "kanban_tasks", "merge_status", "TEXT");
    ensureColumn(this.database, "kanban_tasks", "trashed_at", "INTEGER");
    ensureColumn(this.database, "kanban_settings", "provider_defaults_json", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(this.database, "kanban_settings", "worktree_include_json", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(this.database, "kanban_task_runtime", "latest_preview", "TEXT");
    ensureColumn(this.database, "kanban_task_runtime", "latest_activity_kind", "TEXT");
    ensureColumn(this.database, "kanban_task_runtime", "merge_status", "TEXT");
    ensureColumn(this.database, "kanban_task_runtime", "trash_status", "TEXT NOT NULL DEFAULT 'active'");
    ensureColumn(this.database, "kanban_task_runtime", "trashed_at", "INTEGER");
    this.migrateLegacyArchiveTasks();
    this.schedulerTimer = setInterval(() => {
      void this.runSchedulerTick();
    }, 30_000);
    this.schedulerTimer.unref?.();
  }

  private migrateLegacyKanbanSchema() {
    const settingsColumns = tableColumns(this.database, "kanban_settings");
    if (settingsColumns.has("symlink_policy_json")) {
      this.database.exec(`
        ALTER TABLE kanban_settings RENAME TO kanban_settings_legacy;
        CREATE TABLE kanban_settings (
          workspace_dir TEXT PRIMARY KEY,
          auto_commit INTEGER NOT NULL,
          auto_pr INTEGER NOT NULL,
          default_provider TEXT NOT NULL,
          script_shortcuts_json TEXT NOT NULL,
          worktree_include_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        );
        INSERT INTO kanban_settings (
          workspace_dir, auto_commit, auto_pr, default_provider, script_shortcuts_json, worktree_include_json, updated_at
        )
        SELECT
          workspace_dir,
          auto_commit,
          auto_pr,
          default_provider,
          script_shortcuts_json,
          CASE
            WHEN worktree_include_json IS NULL OR TRIM(worktree_include_json) = '' THEN '{}'
            ELSE worktree_include_json
          END,
          updated_at
        FROM kanban_settings_legacy;
        DROP TABLE kanban_settings_legacy;
      `);
    }

    const runtimeColumns = tableColumns(this.database, "kanban_task_runtime");
    if (runtimeColumns.has("archived_at")) {
      this.database.exec(`
        ALTER TABLE kanban_task_runtime RENAME TO kanban_task_runtime_legacy;
        CREATE TABLE kanban_task_runtime (
          task_id TEXT PRIMARY KEY,
          workspace_dir TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL,
          resume_token TEXT,
          terminal_id TEXT,
          worktree_path TEXT,
          base_ref TEXT,
          task_branch TEXT,
          last_event_summary TEXT,
          latest_preview TEXT,
          latest_activity_kind TEXT,
          merge_status TEXT,
          trash_status TEXT NOT NULL DEFAULT 'active',
          checkpoint_cursor TEXT,
          last_checkpoint_id TEXT,
          updated_at INTEGER NOT NULL,
          trashed_at INTEGER
        );
        INSERT INTO kanban_task_runtime (
          task_id, workspace_dir, provider, status, resume_token, terminal_id, worktree_path, base_ref, task_branch,
          last_event_summary, latest_preview, latest_activity_kind, merge_status, trash_status, checkpoint_cursor,
          last_checkpoint_id, updated_at, trashed_at
        )
        SELECT
          task_id,
          workspace_dir,
          provider,
          status,
          resume_token,
          terminal_id,
          worktree_path,
          base_ref,
          task_branch,
          last_event_summary,
          latest_preview,
          latest_activity_kind,
          merge_status,
          COALESCE(trash_status, 'active'),
          checkpoint_cursor,
          last_checkpoint_id,
          updated_at,
          COALESCE(trashed_at, archived_at)
        FROM kanban_task_runtime_legacy;
        DROP TABLE kanban_task_runtime_legacy;
      `);
    }
  }

  private migrateLegacyArchiveTasks() {
    this.database.prepare(`
      UPDATE kanban_tasks
      SET
        restore_column_id = COALESCE(restore_column_id, CASE WHEN column_id = 'archived' THEN 'done' ELSE column_id END),
        column_id = CASE WHEN column_id = 'archived' THEN 'done' ELSE column_id END,
        trash_status = CASE WHEN column_id = 'archived' OR trash_status = 'trashed' THEN 'trashed' ELSE trash_status END,
        trashed_at = COALESCE(trashed_at, completed_at, updated_at)
      WHERE column_id = 'archived' OR trash_status = 'trashed'
    `).run();

    this.database.prepare(`
      UPDATE kanban_task_runtime
      SET
        trash_status = CASE WHEN status = 'archived' OR trash_status = 'trashed' THEN 'trashed' ELSE trash_status END,
        trashed_at = COALESCE(trashed_at, updated_at)
      WHERE status = 'archived' OR trash_status = 'trashed'
    `).run();
  }

  private emitEvent(event: OrxaEvent) {
    this.onEvent?.(event);
  }

  private touchWorkspace(workspaceDir: string) {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO kanban_workspaces (workspace_dir, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET updated_at = excluded.updated_at
    `).run(workspaceDir, now, now);
  }

  private touchBoard(workspaceDir: string) {
    this.touchWorkspace(workspaceDir);
    this.database.prepare(`
      INSERT INTO kanban_boards (workspace_dir, updated_at)
      VALUES (?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET updated_at = excluded.updated_at
    `).run(workspaceDir, Date.now());
  }

  private parseWorkspace(row: Record<string, unknown>): KanbanWorkspace {
    const directory = asString(row.workspace_dir);
    return {
      directory,
      name: path.basename(directory) || directory,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
    };
  }

  private parseTask(row: Record<string, unknown>): KanbanTask {
    const workspaceDir = asString(row.workspace_dir);
    const task = {
      id: asString(row.id),
      workspaceDir,
      title: asString(row.title),
      prompt: asString(row.prompt),
      description: asString(row.description),
      provider: (asString(row.provider) || "opencode") as KanbanProvider,
      providerConfig: parseJson<KanbanTask["providerConfig"]>(row.provider_config_json, undefined),
      columnId: (asString(row.column_id) || "backlog") as KanbanColumnId,
      position: Number(row.position) || 0,
      statusSummary: (asString(row.status_summary) || "idle") as KanbanTaskStatusSummary,
      worktreePath: asString(row.worktree_path) || undefined,
      baseRef: asString(row.base_ref) || undefined,
      taskBranch: asString(row.task_branch) || undefined,
      providerSessionKey: asString(row.provider_session_key) || undefined,
      providerThreadId: asString(row.provider_thread_id) || undefined,
      latestRunId: asString(row.latest_run_id) || undefined,
      autoStartWhenUnblocked: Number(row.auto_start_when_unblocked) === 1,
      blocked: false,
      shipStatus: (asString(row.ship_status) || "unshipped") as KanbanTask["shipStatus"],
      trashStatus: (asString(row.trash_status) || "active") as KanbanTaskTrashStatus,
      restoreColumnId: (asString(row.restore_column_id) || undefined) as KanbanTask["restoreColumnId"],
      latestPreview: asString(row.latest_preview) || undefined,
      latestActivityKind: (asString(row.latest_activity_kind) || undefined) as KanbanTaskActivityKind | undefined,
      mergeStatus: (asString(row.merge_status) || undefined) as KanbanMergeStatus | undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      completedAt: typeof row.completed_at === "number" ? row.completed_at : undefined,
      trashedAt: typeof row.trashed_at === "number" ? row.trashed_at : undefined,
    } satisfies KanbanTask;
    return task;
  }

  private parseDependency(row: Record<string, unknown>): KanbanTaskDependency {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      fromTaskId: asString(row.from_task_id),
      toTaskId: asString(row.to_task_id),
      createdAt: Number(row.created_at) || Date.now(),
    };
  }

  private parseRun(row: Record<string, unknown>): KanbanRun {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      taskId: asString(row.task_id) || undefined,
      automationId: asString(row.automation_id) || undefined,
      provider: (asString(row.provider) || "opencode") as KanbanProvider,
      status: (asString(row.status) || "running") as KanbanRun["status"],
      sessionKey: asString(row.session_key) || undefined,
      providerThreadId: asString(row.provider_thread_id) || undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      completedAt: typeof row.completed_at === "number" ? row.completed_at : undefined,
      shipStatus: (asString(row.ship_status) || "unshipped") as KanbanRun["shipStatus"],
      error: asString(row.error) || undefined,
      logs: parseJson<KanbanRunLogItem[]>(row.logs_json, []),
    };
  }

  private parseAutomation(row: Record<string, unknown>): KanbanAutomation {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      name: asString(row.name),
      prompt: asString(row.prompt),
      provider: (asString(row.provider) || "opencode") as KanbanProvider,
      browserModeEnabled: Number(row.browser_mode_enabled) === 1,
      enabled: Number(row.enabled) === 1,
      autoStart: Number(row.auto_start) === 1,
      schedule: parseJson<KanbanSchedule>(row.schedule_json, { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] }),
      lastRunAt: typeof row.last_run_at === "number" ? row.last_run_at : undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
    };
  }

  private parseReviewComment(row: Record<string, unknown>): KanbanReviewComment {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      taskId: asString(row.task_id),
      runId: asString(row.run_id) || undefined,
      filePath: asString(row.file_path),
      line: Number(row.line) || 1,
      body: asString(row.body),
      createdAt: Number(row.created_at) || Date.now(),
    };
  }

  private parseSettings(row: Record<string, unknown> | null, workspaceDir: string): KanbanSettings {
    if (!row) {
      return defaultKanbanSettings(workspaceDir);
    }
    return {
      workspaceDir,
      autoCommit: Number(row.auto_commit) === 1,
      autoPr: Number(row.auto_pr) === 1,
      defaultProvider: (asString(row.default_provider) || "opencode") as KanbanProvider,
      providerDefaults: parseJson<KanbanSettings["providerDefaults"]>(row.provider_defaults_json, {}),
      scriptShortcuts: parseJson<KanbanSettings["scriptShortcuts"]>(row.script_shortcuts_json, []),
      worktreeInclude: parseJson<KanbanSettings["worktreeInclude"]>(
        row.worktree_include_json,
        defaultKanbanSettings(workspaceDir).worktreeInclude,
      ),
      updatedAt: Number(row.updated_at) || Date.now(),
    };
  }

  private parseRuntime(row: Record<string, unknown>): KanbanTaskRuntime {
    return {
      taskId: asString(row.task_id),
      workspaceDir: asString(row.workspace_dir),
      provider: (asString(row.provider) || "opencode") as KanbanProvider,
      status: (asString(row.status) || "idle") as KanbanRuntimeStatus,
      resumeToken: asString(row.resume_token) || undefined,
      terminalId: asString(row.terminal_id) || undefined,
      worktreePath: asString(row.worktree_path) || undefined,
      baseRef: asString(row.base_ref) || undefined,
      taskBranch: asString(row.task_branch) || undefined,
      lastEventSummary: asString(row.last_event_summary) || undefined,
      latestPreview: asString(row.latest_preview) || undefined,
      latestActivityKind: (asString(row.latest_activity_kind) || undefined) as KanbanTaskActivityKind | undefined,
      mergeStatus: (asString(row.merge_status) || undefined) as KanbanMergeStatus | undefined,
      trashStatus: (asString(row.trash_status) || "active") as KanbanTaskTrashStatus,
      checkpointCursor: asString(row.checkpoint_cursor) || undefined,
      lastCheckpointId: asString(row.last_checkpoint_id) || undefined,
      updatedAt: Number(row.updated_at) || Date.now(),
      trashedAt: typeof row.trashed_at === "number" ? row.trashed_at : undefined,
    };
  }

  private parseWorktree(row: Record<string, unknown>): KanbanWorktree {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      taskId: asString(row.task_id) || undefined,
      label: asString(row.label),
      provider: (asString(row.provider) || undefined) as KanbanProvider | undefined,
      repoRoot: asString(row.repo_root),
      directory: asString(row.directory),
      branch: asString(row.branch),
      baseRef: asString(row.base_ref),
      status: (asString(row.status) || "ready") as KanbanWorktree["status"],
      mergeStatus: (asString(row.merge_status) || "clean") as KanbanMergeStatus,
      latestPreview: asString(row.latest_preview) || undefined,
      latestActivityKind: (asString(row.latest_activity_kind) || undefined) as KanbanTaskActivityKind | undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
      trashedAt: typeof row.trashed_at === "number" ? row.trashed_at : undefined,
    };
  }

  private parseCheckpoint(row: Record<string, unknown>): KanbanTaskCheckpoint {
    return {
      id: asString(row.id),
      workspaceDir: asString(row.workspace_dir),
      taskId: asString(row.task_id),
      runId: asString(row.run_id) || undefined,
      label: asString(row.label),
      source: (asString(row.source) || "manual") as KanbanTaskCheckpoint["source"],
      sessionKey: asString(row.session_key) || undefined,
      providerThreadId: asString(row.provider_thread_id) || undefined,
      gitRevision: asString(row.git_revision) || undefined,
      diffRaw: asString(row.diff_raw),
      createdAt: Number(row.created_at) || Date.now(),
    };
  }

  private parseManagementSession(row: Record<string, unknown>): KanbanManagementSession {
    return {
      workspaceDir: asString(row.workspace_dir),
      provider: (asString(row.provider) || "opencode") as KanbanProvider,
      sessionKey: asString(row.session_key),
      providerThreadId: asString(row.provider_thread_id) || undefined,
      status: (asString(row.status) || "idle") as KanbanManagementSession["status"],
      transcript: parseJson<KanbanManagementSession["transcript"]>(row.transcript_json, []),
      updatedAt: Number(row.updated_at) || Date.now(),
      lastError: asString(row.last_error) || undefined,
    };
  }

  private listTasks(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_tasks
      WHERE workspace_dir = ?
      ORDER BY column_id ASC, position ASC, updated_at DESC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseTask(row));
  }

  private listDependencies(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_task_dependencies
      WHERE workspace_dir = ?
      ORDER BY created_at ASC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseDependency(row));
  }

  private listRunsInternal(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_runs
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseRun(row));
  }

  private listAutomationsInternal(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_automations
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseAutomation(row));
  }

  private listReviewComments(workspaceDir: string, taskId?: string) {
    const rows = taskId
      ? this.database.prepare(`
        SELECT * FROM kanban_review_comments
        WHERE workspace_dir = ? AND task_id = ?
        ORDER BY created_at ASC
      `).all(workspaceDir, taskId) as Record<string, unknown>[]
      : this.database.prepare(`
        SELECT * FROM kanban_review_comments
        WHERE workspace_dir = ?
        ORDER BY created_at ASC
      `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseReviewComment(row));
  }

  private listWorkspacesInternal() {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_workspaces
      ORDER BY updated_at DESC, workspace_dir ASC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => this.parseWorkspace(row));
  }

  private getSettingsInternal(workspaceDir: string) {
    const row = this.database.prepare(`
      SELECT * FROM kanban_settings
      WHERE workspace_dir = ?
    `).get(workspaceDir) as Record<string, unknown> | undefined;
    return this.parseSettings(row ?? null, workspaceDir);
  }

  private listRuntimesInternal(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_task_runtime
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseRuntime(row));
  }

  private listWorktreesInternal(workspaceDir: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_worktrees
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(workspaceDir) as Record<string, unknown>[];
    return rows.map((row) => this.parseWorktree(row));
  }

  private getTaskRuntimeInternal(workspaceDir: string, taskId: string) {
    const row = this.database.prepare(`
      SELECT * FROM kanban_task_runtime
      WHERE workspace_dir = ? AND task_id = ?
    `).get(workspaceDir, taskId) as Record<string, unknown> | undefined;
    return row ? this.parseRuntime(row) : null;
  }

  private listCheckpointsInternal(workspaceDir: string, taskId: string) {
    const rows = this.database.prepare(`
      SELECT * FROM kanban_task_checkpoints
      WHERE workspace_dir = ? AND task_id = ?
      ORDER BY created_at DESC
    `).all(workspaceDir, taskId) as Record<string, unknown>[];
    return rows.map((row) => this.parseCheckpoint(row));
  }

  private getManagementSessionInternal(workspaceDir: string, provider: KanbanProvider) {
    const row = this.database.prepare(`
      SELECT * FROM kanban_management_sessions
      WHERE workspace_dir = ? AND provider = ?
    `).get(workspaceDir, provider) as Record<string, unknown> | undefined;
    return row ? this.parseManagementSession(row) : null;
  }

  private withBlocked(tasks: KanbanTask[], dependencies: KanbanTaskDependency[]) {
    const completed = new Set(tasks.filter((task) => task.completedAt || task.statusSummary === "completed" || task.shipStatus === "committed" || task.shipStatus === "pr_opened" || task.shipStatus === "merged").map((task) => task.id));
    return tasks.map((task) => ({
      ...task,
      blocked: dependencies.some((dep) => dep.toTaskId === task.id && !completed.has(dep.fromTaskId)),
    }));
  }

  private upsertTask(task: KanbanTask) {
    this.database.prepare(`
      INSERT INTO kanban_tasks (
        id, workspace_dir, title, prompt, description, provider, provider_config_json, column_id, position,
        status_summary, worktree_path, base_ref, task_branch, provider_session_key,
        provider_thread_id, latest_run_id, auto_start_when_unblocked, ship_status,
        trash_status, restore_column_id, latest_preview, latest_activity_kind, merge_status,
        created_at, updated_at, completed_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        description = excluded.description,
        provider = excluded.provider,
        provider_config_json = excluded.provider_config_json,
        column_id = excluded.column_id,
        position = excluded.position,
        status_summary = excluded.status_summary,
        worktree_path = excluded.worktree_path,
        base_ref = excluded.base_ref,
        task_branch = excluded.task_branch,
        provider_session_key = excluded.provider_session_key,
        provider_thread_id = excluded.provider_thread_id,
        latest_run_id = excluded.latest_run_id,
        auto_start_when_unblocked = excluded.auto_start_when_unblocked,
        ship_status = excluded.ship_status,
        trash_status = excluded.trash_status,
        restore_column_id = excluded.restore_column_id,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        merge_status = excluded.merge_status,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        trashed_at = excluded.trashed_at
    `).run(
      task.id,
      task.workspaceDir,
      task.title,
      task.prompt,
      task.description,
      task.provider,
      JSON.stringify(task.providerConfig ?? {}),
      task.columnId,
      task.position,
      task.statusSummary,
      task.worktreePath ?? null,
      task.baseRef ?? null,
      task.taskBranch ?? null,
      task.providerSessionKey ?? null,
      task.providerThreadId ?? null,
      task.latestRunId ?? null,
      task.autoStartWhenUnblocked ? 1 : 0,
      task.shipStatus ?? "unshipped",
      task.trashStatus,
      task.restoreColumnId ?? null,
      task.latestPreview ?? null,
      task.latestActivityKind ?? null,
      task.mergeStatus ?? null,
      task.createdAt,
      task.updatedAt,
      task.completedAt ?? null,
      task.trashedAt ?? null,
    );
    this.touchBoard(task.workspaceDir);
    return task;
  }

  private upsertRun(run: KanbanRun) {
    this.database.prepare(`
      INSERT INTO kanban_runs (
        id, workspace_dir, task_id, automation_id, provider, status, session_key,
        provider_thread_id, ship_status, error, logs_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        session_key = excluded.session_key,
        provider_thread_id = excluded.provider_thread_id,
        ship_status = excluded.ship_status,
        error = excluded.error,
        logs_json = excluded.logs_json,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `).run(
      run.id,
      run.workspaceDir,
      run.taskId ?? null,
      run.automationId ?? null,
      run.provider,
      run.status,
      run.sessionKey ?? null,
      run.providerThreadId ?? null,
      run.shipStatus ?? "unshipped",
      run.error ?? null,
      JSON.stringify(run.logs),
      run.createdAt,
      run.updatedAt,
      run.completedAt ?? null,
    );
    this.touchBoard(run.workspaceDir);
    return run;
  }

  private upsertSettings(settings: KanbanSettings) {
    this.database.prepare(`
      INSERT INTO kanban_settings (
        workspace_dir, auto_commit, auto_pr, default_provider,
        provider_defaults_json, script_shortcuts_json, worktree_include_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET
        auto_commit = excluded.auto_commit,
        auto_pr = excluded.auto_pr,
        default_provider = excluded.default_provider,
        provider_defaults_json = excluded.provider_defaults_json,
        script_shortcuts_json = excluded.script_shortcuts_json,
        worktree_include_json = excluded.worktree_include_json,
        updated_at = excluded.updated_at
    `).run(
      settings.workspaceDir,
      settings.autoCommit ? 1 : 0,
      settings.autoPr ? 1 : 0,
      settings.defaultProvider,
      JSON.stringify(settings.providerDefaults ?? {}),
      JSON.stringify(settings.scriptShortcuts),
      JSON.stringify(settings.worktreeInclude),
      settings.updatedAt,
    );
    this.touchBoard(settings.workspaceDir);
    return settings;
  }

  private upsertRuntime(runtime: KanbanTaskRuntime) {
    this.database.prepare(`
      INSERT INTO kanban_task_runtime (
        task_id, workspace_dir, provider, status, resume_token, terminal_id,
        worktree_path, base_ref, task_branch, last_event_summary, latest_preview,
        latest_activity_kind, merge_status, trash_status, checkpoint_cursor,
        last_checkpoint_id, updated_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        workspace_dir = excluded.workspace_dir,
        provider = excluded.provider,
        status = excluded.status,
        resume_token = excluded.resume_token,
        terminal_id = excluded.terminal_id,
        worktree_path = excluded.worktree_path,
        base_ref = excluded.base_ref,
        task_branch = excluded.task_branch,
        last_event_summary = excluded.last_event_summary,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        merge_status = excluded.merge_status,
        trash_status = excluded.trash_status,
        checkpoint_cursor = excluded.checkpoint_cursor,
        last_checkpoint_id = excluded.last_checkpoint_id,
        updated_at = excluded.updated_at,
        trashed_at = excluded.trashed_at
    `).run(
      runtime.taskId,
      runtime.workspaceDir,
      runtime.provider,
      runtime.status,
      runtime.resumeToken ?? null,
      runtime.terminalId ?? null,
      runtime.worktreePath ?? null,
      runtime.baseRef ?? null,
      runtime.taskBranch ?? null,
      runtime.lastEventSummary ?? null,
      runtime.latestPreview ?? null,
      runtime.latestActivityKind ?? null,
      runtime.mergeStatus ?? null,
      runtime.trashStatus,
      runtime.checkpointCursor ?? null,
      runtime.lastCheckpointId ?? null,
      runtime.updatedAt,
      runtime.trashedAt ?? null,
    );
    this.touchBoard(runtime.workspaceDir);
    return runtime;
  }

  private upsertWorktree(worktree: KanbanWorktree) {
    this.database.prepare(`
      INSERT INTO kanban_worktrees (
        id, workspace_dir, task_id, label, provider, repo_root, directory, branch, base_ref,
        status, merge_status, latest_preview, latest_activity_kind, created_at, updated_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        label = excluded.label,
        provider = excluded.provider,
        repo_root = excluded.repo_root,
        directory = excluded.directory,
        branch = excluded.branch,
        base_ref = excluded.base_ref,
        status = excluded.status,
        merge_status = excluded.merge_status,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        updated_at = excluded.updated_at,
        trashed_at = excluded.trashed_at
    `).run(
      worktree.id,
      worktree.workspaceDir,
      worktree.taskId ?? null,
      worktree.label,
      worktree.provider ?? null,
      worktree.repoRoot,
      worktree.directory,
      worktree.branch,
      worktree.baseRef,
      worktree.status,
      worktree.mergeStatus,
      worktree.latestPreview ?? null,
      worktree.latestActivityKind ?? null,
      worktree.createdAt,
      worktree.updatedAt,
      worktree.trashedAt ?? null,
    );
    this.touchBoard(worktree.workspaceDir);
    return worktree;
  }

  private upsertManagementSession(session: KanbanManagementSession) {
    this.database.prepare(`
      INSERT INTO kanban_management_sessions (
        workspace_dir, provider, session_key, provider_thread_id,
        status, transcript_json, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_dir, provider) DO UPDATE SET
        session_key = excluded.session_key,
        provider_thread_id = excluded.provider_thread_id,
        status = excluded.status,
        transcript_json = excluded.transcript_json,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      session.workspaceDir,
      session.provider,
      session.sessionKey,
      session.providerThreadId ?? null,
      session.status,
      JSON.stringify(session.transcript),
      session.lastError ?? null,
      session.updatedAt,
    );
    return session;
  }

  private createCheckpointRecord(checkpoint: KanbanTaskCheckpoint) {
    this.database.prepare(`
      INSERT INTO kanban_task_checkpoints (
        id, workspace_dir, task_id, run_id, label, source,
        session_key, provider_thread_id, git_revision, diff_raw, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.workspaceDir,
      checkpoint.taskId,
      checkpoint.runId ?? null,
      checkpoint.label,
      checkpoint.source,
      checkpoint.sessionKey ?? null,
      checkpoint.providerThreadId ?? null,
      checkpoint.gitRevision ?? null,
      checkpoint.diffRaw,
      checkpoint.createdAt,
    );
    const runtime = this.getTaskRuntimeInternal(checkpoint.workspaceDir, checkpoint.taskId);
    if (runtime) {
      this.upsertRuntime({
        ...runtime,
        lastCheckpointId: checkpoint.id,
        updatedAt: Date.now(),
      });
    }
    this.emitEvent({
      type: "kanban.checkpoint",
      payload: {
        workspaceDir: checkpoint.workspaceDir,
        taskId: checkpoint.taskId,
        checkpoint,
      },
    });
    return checkpoint;
  }

  private nextTaskPosition(workspaceDir: string, columnId: KanbanColumnId) {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(position), -1) AS position
      FROM kanban_tasks
      WHERE workspace_dir = ? AND column_id = ?
    `).get(workspaceDir, columnId) as { position?: number } | undefined;
    return (row?.position ?? -1) + 1;
  }

  private buildResumeToken(task: KanbanTask, sessionKey?: string, providerThreadId?: string) {
    return JSON.stringify({
      sessionKey: sessionKey ?? task.providerSessionKey ?? null,
      providerThreadId: providerThreadId ?? task.providerThreadId ?? null,
    });
  }

  private syncRuntimeForTask(task: KanbanTask, override?: Partial<KanbanTaskRuntime>) {
    const current = this.getTaskRuntimeInternal(task.workspaceDir, task.id);
    const next: KanbanTaskRuntime = {
      taskId: task.id,
      workspaceDir: task.workspaceDir,
      provider: task.provider,
      status: (override?.status ?? (task.trashStatus === "trashed" ? "archived" : task.statusSummary)) as KanbanRuntimeStatus,
      resumeToken: override?.resumeToken ?? this.buildResumeToken(task),
      terminalId: override?.terminalId ?? current?.terminalId,
      worktreePath: override?.worktreePath ?? task.worktreePath ?? current?.worktreePath,
      baseRef: override?.baseRef ?? task.baseRef ?? current?.baseRef,
      taskBranch: override?.taskBranch ?? task.taskBranch ?? current?.taskBranch,
      lastEventSummary: override?.lastEventSummary ?? current?.lastEventSummary,
      latestPreview: override?.latestPreview ?? task.latestPreview ?? current?.latestPreview,
      latestActivityKind: override?.latestActivityKind ?? task.latestActivityKind ?? current?.latestActivityKind,
      mergeStatus: override?.mergeStatus ?? task.mergeStatus ?? current?.mergeStatus,
      trashStatus: override?.trashStatus ?? task.trashStatus ?? current?.trashStatus ?? "active",
      checkpointCursor: override?.checkpointCursor ?? current?.checkpointCursor,
      lastCheckpointId: override?.lastCheckpointId ?? current?.lastCheckpointId,
      updatedAt: Date.now(),
      trashedAt: override?.trashedAt ?? task.trashedAt ?? current?.trashedAt,
    };
    return this.upsertRuntime(next);
  }

  private syncWorktreeForTask(task: KanbanTask, override?: Partial<KanbanWorktree>) {
    if (!task.worktreePath || !task.taskBranch || !task.baseRef) {
      return null;
    }
    const current = this.listWorktreesInternal(task.workspaceDir).find((item) => item.taskId === task.id || item.directory === task.worktreePath);
    const next: KanbanWorktree = {
      id: current?.id ?? randomUUID(),
      workspaceDir: task.workspaceDir,
      taskId: task.id,
      label: override?.label ?? task.title,
      provider: task.provider,
      repoRoot: override?.repoRoot ?? current?.repoRoot ?? task.workspaceDir,
      directory: override?.directory ?? task.worktreePath,
      branch: override?.branch ?? task.taskBranch,
      baseRef: override?.baseRef ?? task.baseRef,
      status: override?.status ?? (task.trashStatus === "trashed" ? "trashed" : task.statusSummary === "running" ? "active" : "ready"),
      mergeStatus: override?.mergeStatus ?? task.mergeStatus ?? current?.mergeStatus ?? "clean",
      latestPreview: override?.latestPreview ?? task.latestPreview ?? current?.latestPreview,
      latestActivityKind: override?.latestActivityKind ?? task.latestActivityKind ?? current?.latestActivityKind,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      trashedAt: override?.trashedAt ?? task.trashedAt ?? current?.trashedAt,
    };
    return this.upsertWorktree(next);
  }

  private async resolveGitRevision(directory: string) {
    const output = await this.commands.runCommandWithOutput("git", ["-C", directory, "rev-parse", "HEAD"], directory).catch(() => "");
    return output.trim() || undefined;
  }

  private async resolveRepoRoot(directory: string) {
    const output = await this.commands.runCommandWithOutput("git", ["-C", directory, "rev-parse", "--show-toplevel"], directory).catch(() => "");
    return output.trim() || path.resolve(directory);
  }

  private resolveWorktreeIncludeSettings(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir);
    const repoRoot = existsSync(normalized) ? normalized : path.resolve(workspaceDir);
    const current = this.getSettingsInternal(normalized);
    const include = this.worktrees.readWorktreeInclude(repoRoot);
    if (include.detected || current.worktreeInclude.source !== "none" || current.worktreeInclude.entries.length === 0) {
      return { settings: { ...current, worktreeInclude: include }, repoRoot };
    }
    return {
      settings: {
        ...current,
        worktreeInclude: {
          ...current.worktreeInclude,
          filePath: include.filePath,
          detected: false,
        },
      },
      repoRoot,
    };
  }

  private async captureCurrentDiff(task: KanbanTask) {
    const directory = task.worktreePath ?? task.workspaceDir;
    return this.opencodeService.gitDiff(directory).catch((error) => sanitizeError(error));
  }

  private async createCheckpoint(task: KanbanTask, source: KanbanTaskCheckpoint["source"], label: string) {
    const diffRaw = await this.captureCurrentDiff(task);
    const checkpoint: KanbanTaskCheckpoint = {
      id: randomUUID(),
      workspaceDir: task.workspaceDir,
      taskId: task.id,
      runId: task.latestRunId,
      label,
      source,
      sessionKey: task.providerSessionKey,
      providerThreadId: task.providerThreadId,
      gitRevision: await this.resolveGitRevision(task.worktreePath ?? task.workspaceDir),
      diffRaw,
      createdAt: Date.now(),
    };
    return this.createCheckpointRecord(checkpoint);
  }

  private async ensureTaskTerminal(task: KanbanTask) {
    const runtime = this.getTaskRuntimeInternal(task.workspaceDir, task.id);
    if (runtime?.terminalId) {
      const current = this.terminalService.listPtys(task.workspaceDir, "kanban").find((entry) => entry.id === runtime.terminalId);
      if (current) {
        return current;
      }
    }
    const cwd = task.worktreePath ?? task.workspaceDir;
    const terminal = this.terminalService.createPty(task.workspaceDir, cwd, `Kanban: ${task.title}`, "kanban");
    this.syncRuntimeForTask(task, { terminalId: terminal.id, worktreePath: cwd });
    this.emitEvent({
      type: "kanban.runtime",
      payload: { workspaceDir: task.workspaceDir, runtime: this.getTaskRuntimeInternal(task.workspaceDir, task.id)! },
    });
    return terminal;
  }

  private async maybeAutoShipTask(task: KanbanTask) {
    if (!task.completedAt || task.trashStatus === "trashed" || task.shipStatus === "committed" || task.shipStatus === "pr_opened" || task.shipStatus === "merged") {
      return;
    }
    const settings = this.getSettingsInternal(task.workspaceDir);
    if (settings.autoPr) {
      await this.openTaskPr(task.workspaceDir, task.id).catch(() => undefined);
      return;
    }
    if (settings.autoCommit) {
      await this.commitTask(task.workspaceDir, task.id).catch(() => undefined);
    }
  }

  private async refreshTask(task: KanbanTask) {
    try {
      let lastEventSummary = "";
      let latestPreview = task.latestPreview ?? "";
      let latestActivityKind: KanbanTaskActivityKind | undefined = task.latestActivityKind;
      if (task.provider === "opencode" && task.worktreePath && task.providerThreadId) {
        const runtime = await this.opencodeService.getSessionRuntime(task.worktreePath, task.providerThreadId);
        const sessionStatusType = asString((runtime.sessionStatus as Record<string, unknown> | undefined)?.type).toLowerCase();
        lastEventSummary = runtime.commands.map((entry) => asString((entry as Record<string, unknown>).command)).find(Boolean)
          ?? runtime.questions.map((entry) => asString((entry as Record<string, unknown>).message)).find(Boolean)
          ?? runtime.permissions.map((entry) => asString(asRecord((entry as Record<string, unknown>).call)?.command)).find(Boolean)
          ?? "";
        latestPreview = runtime.messages.at(-1)?.parts.map((part) => {
          const record = part as Record<string, unknown>;
          return asString(record.text ?? record.content).trim();
        }).filter(Boolean).join("\n\n") || lastEventSummary;
        latestActivityKind = runtime.commands.length > 0
          ? "tool"
          : runtime.questions.length > 0
            ? "question"
            : runtime.permissions.length > 0
              ? "permission"
              : "assistant";
        task.statusSummary = runtime.questions.length > 0 || runtime.permissions.length > 0
          ? "awaiting_input"
          : sessionStatusType.includes("complete")
            ? "completed"
            : sessionStatusType.includes("error")
              ? "failed"
              : sessionStatusType.includes("idle")
                ? "idle"
                : "running";
      } else if (task.provider === "codex" && task.providerThreadId) {
        const runtime = await this.codexService.getThreadRuntime(task.providerThreadId);
        const statusType = asString(asRecord(asRecord(runtime.thread)?.status)?.type).toLowerCase();
        lastEventSummary = asString(asRecord(runtime.thread)?.preview);
        latestPreview = lastEventSummary;
        latestActivityKind = "assistant";
        task.statusSummary = statusType.includes("await") ? "awaiting_input"
          : statusType.includes("error") ? "failed"
            : statusType.includes("done") || statusType.includes("completed") ? "completed"
              : runtime.thread ? "running" : "stopped";
      } else if (task.provider === "claude" && task.providerSessionKey) {
        const state = await this.claudeChatService.getState(task.providerSessionKey);
        task.providerThreadId = state.providerThreadId;
        lastEventSummary = state.lastError ?? "";
        latestPreview = state.lastError ?? task.latestPreview ?? "";
        latestActivityKind = state.activeTurnId ? "assistant" : task.latestActivityKind;
        task.statusSummary = state.status === "error"
          ? "failed"
          : state.status === "disconnected"
            ? "stopped"
            : state.activeTurnId
              ? "running"
              : "idle";
      }
      if (task.statusSummary === "completed" && !task.completedAt) {
        task.completedAt = Date.now();
      }
      task.latestPreview = latestPreview || task.latestPreview;
      task.latestActivityKind = latestActivityKind ?? task.latestActivityKind;
      task.updatedAt = Date.now();
      this.upsertTask(task);
      const runtime = this.syncRuntimeForTask(task, { lastEventSummary, latestPreview: task.latestPreview, latestActivityKind: task.latestActivityKind });
      this.syncWorktreeForTask(task, { latestPreview: task.latestPreview, latestActivityKind: task.latestActivityKind });
      this.emitEvent({ type: "kanban.runtime", payload: { workspaceDir: task.workspaceDir, runtime } });
      await this.maybeAutoShipTask(task);
    } catch {
      // Best effort runtime refresh.
    }
    return task;
  }

  private async refreshWorkspace(workspaceDir: string) {
    const tasks = this.listTasks(workspaceDir);
    await Promise.all(tasks.filter((task) => task.statusSummary === "running" || task.statusSummary === "starting").map((task) => this.refreshTask(task)));
    await this.evaluateDueAutomations(workspaceDir);
    await this.tryAutoStartUnblocked(workspaceDir);
  }

  async listWorkspaces() {
    return this.listWorkspacesInternal();
  }

  async addWorkspaceDirectory(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir);
    this.touchWorkspace(normalized);
    return this.listWorkspacesInternal().find((workspace) => workspace.directory === normalized);
  }

  async removeWorkspaceDirectory(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir);
    for (const terminal of this.terminalService.listPtys(normalized, "kanban")) {
      try {
        this.terminalService.closePty(normalized, terminal.id);
      } catch {
        // Best effort terminal cleanup.
      }
    }
    this.database.prepare(`DELETE FROM kanban_review_comments WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_task_checkpoints WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_task_runtime WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_management_sessions WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_settings WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_runs WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_task_dependencies WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_tasks WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_automations WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_boards WHERE workspace_dir = ?`).run(normalized);
    this.database.prepare(`DELETE FROM kanban_workspaces WHERE workspace_dir = ?`).run(normalized);
    return true;
  }

  async getSettings(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir);
    this.touchWorkspace(normalized);
    const { settings } = this.resolveWorktreeIncludeSettings(normalized);
    return settings;
  }

  async updateSettings(input: KanbanUpdateSettingsInput) {
    const normalized = path.resolve(input.workspaceDir);
    const current = this.getSettingsInternal(normalized);
    const next: KanbanSettings = {
      ...current,
      ...input,
      workspaceDir: normalized,
      updatedAt: Date.now(),
      providerDefaults: input.providerDefaults ?? current.providerDefaults,
      scriptShortcuts: input.scriptShortcuts ?? current.scriptShortcuts,
      worktreeInclude: input.worktreeInclude ?? current.worktreeInclude,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      autoCommit: input.autoCommit ?? current.autoCommit,
      autoPr: input.autoPr ?? current.autoPr,
    };
    return this.upsertSettings(next);
  }

  async getBoard(workspaceDir: string): Promise<KanbanBoardSnapshot> {
    const normalized = path.resolve(workspaceDir);
    this.touchBoard(normalized);
    await this.refreshWorkspace(normalized);
    const tasks = this.listTasks(normalized);
    const dependencies = this.listDependencies(normalized);
    const activeTasks = tasks.filter((task) => task.trashStatus !== "trashed");
    const trashedTasks = tasks.filter((task) => task.trashStatus === "trashed");
    const snapshot = {
      workspaceDir: normalized,
      settings: this.getSettingsInternal(normalized),
      tasks: this.withBlocked(activeTasks, dependencies),
      trashedTasks,
      runtimes: this.listRuntimesInternal(normalized),
      worktrees: this.listWorktreesInternal(normalized),
      dependencies,
      runs: this.listRunsInternal(normalized),
      automations: this.listAutomationsInternal(normalized),
      reviewComments: this.listReviewComments(normalized),
    } satisfies KanbanBoardSnapshot;
    this.emitEvent({ type: "kanban.board", payload: { workspaceDir: normalized, snapshot } });
    return snapshot;
  }

  async importLegacyJobs(input: KanbanLegacyImportInput) {
    for (const job of input.jobs) {
      const normalized = path.resolve(job.projectDir);
      const existing = this.database.prepare(`
        SELECT id FROM kanban_automations WHERE id = ?
      `).get(job.id) as { id?: string } | undefined;
      if (!existing) {
        this.createAutomation({
          id: job.id,
          workspaceDir: normalized,
          name: job.name,
          prompt: job.prompt,
          provider: job.agentMode ?? "opencode",
          browserModeEnabled: job.browserModeEnabled === true,
          enabled: job.enabled,
          autoStart: true,
          schedule: job.schedule,
          lastRunAt: job.lastRunAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
      }
    }
    for (const run of input.runs) {
      const existing = this.database.prepare(`SELECT id FROM kanban_runs WHERE id = ?`).get(run.id) as { id?: string } | undefined;
      if (existing) {
        continue;
      }
      this.upsertRun({
        id: run.id,
        workspaceDir: path.resolve(run.projectDir),
        automationId: run.jobID,
        provider: "opencode",
        status: run.status === "failed" ? "failed" : run.status === "completed" ? "completed" : "running",
        sessionKey: run.sessionID,
        providerThreadId: run.sessionID,
        createdAt: run.createdAt,
        updatedAt: run.completedAt ?? run.createdAt,
        completedAt: run.completedAt,
        error: run.error,
        logs: [{
          id: randomUUID(),
          kind: "system",
          level: run.error ? "error" : "info",
          message: run.error ?? `Migrated legacy job run: ${run.jobName}`,
          timestamp: run.createdAt,
        }],
      });
    }
    return true;
  }

  private createAutomation(input: KanbanCreateAutomationInput & { id?: string; lastRunAt?: number; createdAt?: number; updatedAt?: number; enabled?: boolean }) {
    const now = Date.now();
    const automation: KanbanAutomation = {
      id: input.id ?? randomUUID(),
      workspaceDir: path.resolve(input.workspaceDir),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      provider: input.provider,
      browserModeEnabled: input.browserModeEnabled === true,
      enabled: input.enabled ?? true,
      autoStart: input.autoStart ?? true,
      schedule: input.schedule,
      lastRunAt: input.lastRunAt,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.database.prepare(`
      INSERT INTO kanban_automations (
        id, workspace_dir, name, prompt, provider, browser_mode_enabled,
        enabled, auto_start, schedule_json, last_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        prompt = excluded.prompt,
        provider = excluded.provider,
        browser_mode_enabled = excluded.browser_mode_enabled,
        enabled = excluded.enabled,
        auto_start = excluded.auto_start,
        schedule_json = excluded.schedule_json,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at
    `).run(
      automation.id,
      automation.workspaceDir,
      automation.name,
      automation.prompt,
      automation.provider,
      automation.browserModeEnabled ? 1 : 0,
      automation.enabled ? 1 : 0,
      automation.autoStart ? 1 : 0,
      JSON.stringify(automation.schedule),
      automation.lastRunAt ?? null,
      automation.createdAt,
      automation.updatedAt,
    );
    this.touchBoard(automation.workspaceDir);
    return automation;
  }

  async listAutomations(workspaceDir: string) {
    return this.listAutomationsInternal(path.resolve(workspaceDir));
  }

  async createAutomationPublic(input: KanbanCreateAutomationInput) {
    return this.createAutomation(input);
  }

  async updateAutomation(input: KanbanUpdateAutomationInput) {
    const normalized = path.resolve(input.workspaceDir);
    const current = this.listAutomationsInternal(normalized).find((automation) => automation.id === input.id);
    if (!current) {
      throw new Error("Automation not found");
    }
    return this.createAutomation({
      ...current,
      ...input,
      workspaceDir: normalized,
      updatedAt: Date.now(),
    });
  }

  async deleteAutomation(workspaceDir: string, automationId: string) {
    this.database.prepare(`DELETE FROM kanban_automations WHERE workspace_dir = ? AND id = ?`).run(path.resolve(workspaceDir), automationId);
    return true;
  }

  async createTask(input: KanbanCreateTaskInput) {
    const normalized = path.resolve(input.workspaceDir);
    const task: KanbanTask = {
      id: randomUUID(),
      workspaceDir: normalized,
      title: input.title.trim() || "New task",
      prompt: input.prompt.trim(),
      description: input.description?.trim() || "",
      provider: input.provider,
      providerConfig: input.providerConfig,
      columnId: input.columnId ?? "backlog",
      position: this.nextTaskPosition(normalized, input.columnId ?? "backlog"),
      statusSummary: "idle",
      baseRef: input.baseRef?.trim() || undefined,
      autoStartWhenUnblocked: input.autoStartWhenUnblocked === true,
      blocked: false,
      shipStatus: "unshipped",
      trashStatus: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertTask(task);
    this.syncRuntimeForTask(task, { status: "idle" });
    return task;
  }

  async updateTask(input: KanbanUpdateTaskInput) {
    const normalized = path.resolve(input.workspaceDir);
    const current = this.listTasks(normalized).find((task) => task.id === input.id);
    if (!current) {
      throw new Error("Task not found");
    }
    const next = {
      ...current,
      ...input,
      workspaceDir: normalized,
      title: input.title?.trim() ?? current.title,
      prompt: input.prompt?.trim() ?? current.prompt,
      description: input.description?.trim() ?? current.description,
      providerConfig: input.providerConfig ?? current.providerConfig,
      updatedAt: Date.now(),
    } satisfies KanbanTask;
    this.upsertTask(next);
    this.syncRuntimeForTask(next, {
      provider: next.provider,
      baseRef: next.baseRef,
    });
    return next;
  }

  async moveTask(input: KanbanMoveTaskInput) {
    const normalized = path.resolve(input.workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const tasks = this.listTasks(normalized).filter((candidate) => candidate.columnId === input.columnId && candidate.id !== task.id);
    tasks.splice(Math.max(0, Math.min(input.position, tasks.length)), 0, { ...task, columnId: input.columnId, position: 0 });
    tasks.forEach((candidate, index) => {
      const nextTask = {
        ...candidate,
        columnId: input.columnId,
        position: index,
        updatedAt: Date.now(),
        ...(candidate.id === task.id && input.columnId === "done"
          ? { statusSummary: "completed", completedAt: Date.now(), shipStatus: candidate.shipStatus ?? "unshipped" }
          : {}),
      } satisfies KanbanTask;
      this.upsertTask(nextTask);
      this.syncRuntimeForTask(nextTask, {
        status: nextTask.trashStatus === "trashed" ? "archived" : nextTask.statusSummary,
      });
    });
    await this.tryAutoStartUnblocked(normalized);
    return this.getBoard(normalized);
  }

  async trashTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const current = this.listTasks(normalized).find((task) => task.id === taskId);
    if (!current) {
      throw new Error("Task not found");
    }
    await this.stopTask(normalized, taskId).catch(() => undefined);
    await this.worktrees.cleanup(current).catch(() => undefined);
    const next = {
      ...current,
      restoreColumnId: current.columnId,
      trashStatus: "trashed" as const,
      statusSummary: current.completedAt ? "completed" as const : "stopped" as const,
      trashedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertTask(next);
    this.syncRuntimeForTask(next, { status: "archived", trashedAt: Date.now(), trashStatus: "trashed", worktreePath: undefined });
    this.syncWorktreeForTask(next, { status: "trashed", trashedAt: Date.now() });
    await this.tryAutoStartUnblocked(normalized);
    return next;
  }

  async restoreTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const current = this.listTasks(normalized).find((task) => task.id === taskId);
    if (!current) {
      throw new Error("Task not found");
    }
    const next = this.upsertTask({
      ...current,
      trashStatus: "active",
      columnId: current.restoreColumnId ?? "done",
      trashedAt: undefined,
      updatedAt: Date.now(),
    });
    this.syncRuntimeForTask(next, {
      status: next.statusSummary,
      trashStatus: "active",
      trashedAt: undefined,
    });
    this.syncWorktreeForTask(next, { status: "ready", trashedAt: undefined });
    return next;
  }

  async deleteTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const current = this.listTasks(normalized).find((task) => task.id === taskId);
    if (current) {
      await this.stopTask(normalized, taskId).catch(() => undefined);
      await this.worktrees.cleanup(current, { preservePatch: false }).catch(() => undefined);
      const runtime = this.getTaskRuntimeInternal(normalized, taskId);
      if (runtime?.terminalId) {
        try {
          this.terminalService.closePty(normalized, runtime.terminalId);
        } catch {
          // Best effort cleanup.
        }
      }
    }
    this.database.prepare(`DELETE FROM kanban_review_comments WHERE workspace_dir = ? AND task_id = ?`).run(normalized, taskId);
    this.database.prepare(`DELETE FROM kanban_task_checkpoints WHERE workspace_dir = ? AND task_id = ?`).run(normalized, taskId);
    this.database.prepare(`DELETE FROM kanban_task_runtime WHERE workspace_dir = ? AND task_id = ?`).run(normalized, taskId);
    this.database.prepare(`DELETE FROM kanban_task_dependencies WHERE workspace_dir = ? AND (from_task_id = ? OR to_task_id = ?)`).run(normalized, taskId, taskId);
    this.database.prepare(`DELETE FROM kanban_runs WHERE workspace_dir = ? AND task_id = ?`).run(normalized, taskId);
    this.database.prepare(`DELETE FROM kanban_tasks WHERE workspace_dir = ? AND id = ?`).run(normalized, taskId);
    return true;
  }

  async linkTasks(workspaceDir: string, fromTaskId: string, toTaskId: string) {
    const normalized = path.resolve(workspaceDir);
    this.database.prepare(`
      INSERT OR IGNORE INTO kanban_task_dependencies (id, workspace_dir, from_task_id, to_task_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), normalized, fromTaskId, toTaskId, Date.now());
    return this.getBoard(normalized);
  }

  async unlinkTasks(workspaceDir: string, fromTaskId: string, toTaskId: string) {
    const normalized = path.resolve(workspaceDir);
    this.database.prepare(`
      DELETE FROM kanban_task_dependencies WHERE workspace_dir = ? AND from_task_id = ? AND to_task_id = ?
    `).run(normalized, fromTaskId, toTaskId);
    return this.getBoard(normalized);
  }

  private createRun(task: KanbanTask, automationId?: string) {
    const run: KanbanRun = {
      id: randomUUID(),
      workspaceDir: task.workspaceDir,
      taskId: task.id,
      automationId,
      provider: task.provider,
      status: "running",
      sessionKey: task.providerSessionKey,
      providerThreadId: task.providerThreadId,
      shipStatus: task.shipStatus ?? "unshipped",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [{
        id: randomUUID(),
        kind: "system",
        message: `Starting ${task.provider} task`,
        timestamp: Date.now(),
      }],
    };
    this.upsertRun(run);
    return run;
  }

  private updateTaskRunBindings(task: KanbanTask, run: KanbanRun) {
    const next = {
      ...task,
      latestRunId: run.id,
      providerSessionKey: run.sessionKey ?? task.providerSessionKey,
      providerThreadId: run.providerThreadId ?? task.providerThreadId,
      updatedAt: Date.now(),
    };
    this.upsertTask(next);
    return next;
  }

  async startTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    let task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const dependencies = this.listDependencies(normalized);
    task = this.withBlocked([task], dependencies)[0]!;
    if (task.blocked) {
      throw new Error("Task is blocked by unresolved dependencies");
    }
    const { settings } = this.resolveWorktreeIncludeSettings(normalized);
    const worktree = await this.worktrees.ensure(task, settings.worktreeInclude.entries);
    task = this.upsertTask({
      ...task,
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      statusSummary: "starting",
      columnId: task.columnId === "backlog" ? "in_progress" : task.columnId,
      trashStatus: "active",
      updatedAt: Date.now(),
    });
    const terminal = await this.ensureTaskTerminal(task);
    this.syncRuntimeForTask(task, {
      status: "starting",
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      terminalId: terminal.id,
      trashStatus: "active",
    });
    let run = this.createRun(task);
    if (task.provider === "opencode") {
      const session = await this.opencodeService.createSession(worktree.worktreePath, task.title);
      await this.opencodeService.sendPrompt({
        directory: worktree.worktreePath,
        sessionID: session.id,
        text: task.prompt,
        promptSource: "job",
        agent: task.providerConfig?.opencode?.agent,
        model: task.providerConfig?.opencode?.model,
        variant: task.providerConfig?.opencode?.variant,
      });
      run = this.upsertRun({ ...run, sessionKey: session.id, providerThreadId: session.id, updatedAt: Date.now() });
      task = this.updateTaskRunBindings({ ...task, providerSessionKey: session.id, providerThreadId: session.id, statusSummary: "running" }, run);
    } else if (task.provider === "codex") {
      const thread = await this.codexService.startThread({ cwd: worktree.worktreePath, title: task.title });
      await this.codexService.startTurn({
        threadId: thread.id,
        prompt: task.prompt,
        cwd: worktree.worktreePath,
        model: task.providerConfig?.codex?.model,
        effort: task.providerConfig?.codex?.reasoningEffort ?? undefined,
      });
      run = this.upsertRun({ ...run, sessionKey: thread.id, providerThreadId: thread.id, updatedAt: Date.now() });
      task = this.updateTaskRunBindings({ ...task, providerSessionKey: thread.id, providerThreadId: thread.id, statusSummary: "running" }, run);
    } else {
      const sessionKey = task.providerSessionKey || `kanban:claude:${task.id}`;
      await this.claudeChatService.startTurn(sessionKey, worktree.worktreePath, task.prompt, {
        model: task.providerConfig?.claude?.model,
        effort: task.providerConfig?.claude?.effort,
      });
      const state = await this.claudeChatService.getState(sessionKey);
      run = this.upsertRun({ ...run, sessionKey, providerThreadId: state.providerThreadId, updatedAt: Date.now() });
      task = this.updateTaskRunBindings({ ...task, providerSessionKey: sessionKey, providerThreadId: state.providerThreadId, statusSummary: "running" }, run);
    }
    const runtime = this.syncRuntimeForTask(task, {
      status: "running",
      terminalId: terminal.id,
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      resumeToken: this.buildResumeToken(task),
      trashStatus: "active",
    });
    this.syncWorktreeForTask(task, {
      repoRoot: worktree.repoRoot,
      directory: worktree.worktreePath,
      branch: worktree.branch,
      baseRef: worktree.baseRef,
      status: "active",
    });
    await this.createCheckpoint(task, "start", "Task started");
    this.emitEvent({ type: "kanban.task", payload: { workspaceDir: normalized, task } });
    this.emitEvent({ type: "kanban.run", payload: { workspaceDir: normalized, run } });
    this.emitEvent({ type: "kanban.runtime", payload: { workspaceDir: normalized, runtime } });
    return task;
  }

  async resumeTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    if (!task.providerThreadId && !task.providerSessionKey) {
      return this.startTask(normalized, taskId);
    }
    return this.sendReviewFeedback(normalized, taskId, "Continue working on this task.");
  }

  async stopTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    if (task.provider === "opencode" && task.worktreePath && task.providerThreadId) {
      await this.opencodeService.abortSession(task.worktreePath, task.providerThreadId).catch(() => undefined);
    } else if (task.provider === "codex" && task.providerThreadId) {
      await this.codexService.interruptThreadTree(task.providerThreadId).catch(() => undefined);
    } else if (task.provider === "claude" && task.providerSessionKey) {
      await this.claudeChatService.interruptTurn(task.providerSessionKey).catch(() => undefined);
    }
    const next = this.upsertTask({ ...task, statusSummary: "stopped", updatedAt: Date.now() });
    const runtime = this.syncRuntimeForTask(next, { status: "stopped" });
    this.syncWorktreeForTask(next, { status: "stopped" });
    const run = next.latestRunId ? this.listRunsInternal(normalized).find((candidate) => candidate.id === next.latestRunId) : null;
    if (run && run.status === "running") {
      this.upsertRun({
        ...run,
        status: "stopped",
        updatedAt: Date.now(),
        completedAt: Date.now(),
        logs: [...run.logs, {
          id: randomUUID(),
          kind: "system",
          message: "Task stopped",
          timestamp: Date.now(),
        }],
      });
    }
    this.emitEvent({ type: "kanban.runtime", payload: { workspaceDir: normalized, runtime } });
    return next;
  }

  async addReviewComment(workspaceDir: string, taskId: string, filePath: string, line: number, body: string) {
    const normalized = path.resolve(workspaceDir);
    const comment: KanbanReviewComment = {
      id: randomUUID(),
      workspaceDir: normalized,
      taskId,
      filePath,
      line,
      body: body.trim(),
      createdAt: Date.now(),
    };
    this.database.prepare(`
      INSERT INTO kanban_review_comments (id, workspace_dir, task_id, run_id, file_path, line, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(comment.id, comment.workspaceDir, comment.taskId, null, comment.filePath, comment.line, comment.body, comment.createdAt);
    return comment;
  }

  async sendReviewFeedback(workspaceDir: string, taskId: string, body: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const message = body.trim();
    if (!message) {
      return task;
    }
    if (task.provider === "opencode" && task.worktreePath && task.providerThreadId) {
      await this.opencodeService.sendPrompt({
        directory: task.worktreePath,
        sessionID: task.providerThreadId,
        text: message,
        promptSource: "user",
      });
    } else if (task.provider === "codex" && task.providerThreadId) {
      await this.codexService.startTurn({ threadId: task.providerThreadId, prompt: message, cwd: task.worktreePath ?? task.workspaceDir });
    } else if (task.provider === "claude" && task.providerSessionKey) {
      await this.claudeChatService.startTurn(task.providerSessionKey, task.worktreePath ?? task.workspaceDir, message);
    } else {
      return this.startTask(normalized, task.id);
    }
    const next = this.upsertTask({
      ...task,
      statusSummary: "running",
      columnId: "review",
      latestPreview: message,
      latestActivityKind: "review",
      updatedAt: Date.now(),
    });
    const runtime = this.syncRuntimeForTask(next, { status: "running", lastEventSummary: message, latestPreview: message, latestActivityKind: "review" });
    this.syncWorktreeForTask(next, { status: "active", latestPreview: message, latestActivityKind: "review" });
    const run = next.latestRunId ? this.listRunsInternal(normalized).find((candidate) => candidate.id === next.latestRunId) : null;
    if (run) {
      this.upsertRun({
        ...run,
        status: "running",
        updatedAt: Date.now(),
        logs: [...run.logs, {
          id: randomUUID(),
          kind: "review_feedback",
          message,
          timestamp: Date.now(),
        }],
      });
    }
    await this.createCheckpoint(next, "review", "Review feedback");
    this.emitEvent({ type: "kanban.runtime", payload: { workspaceDir: normalized, runtime } });
    return next;
  }

  async commitTask(workspaceDir: string, taskId: string, message?: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task?.worktreePath) {
      throw new Error("Task worktree not found");
    }
    const result = await this.opencodeService.gitCommit(task.worktreePath, {
      includeUnstaged: true,
      message,
      nextStep: "commit",
    } satisfies GitCommitRequest);
    const run = this.listRunsInternal(normalized).find((candidate) => candidate.id === task.latestRunId) ?? this.createRun(task);
    const nextRun = this.upsertRun({
      ...run,
      status: "completed",
      shipStatus: "committed",
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [...run.logs, {
        id: randomUUID(),
        kind: "ship",
        message: `Committed ${result.commitHash.slice(0, 7)}`,
        timestamp: Date.now(),
        }],
      });
    const nextTask = this.upsertTask({
      ...task,
      shipStatus: "committed",
      columnId: "done",
      statusSummary: "completed",
      latestActivityKind: "ship",
      latestPreview: "Committed changes",
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    this.syncRuntimeForTask(nextTask, { status: "completed", lastEventSummary: "Committed changes", latestActivityKind: "ship", latestPreview: "Committed changes" });
    this.syncWorktreeForTask(nextTask, { status: "ready", latestActivityKind: "ship", latestPreview: "Committed changes" });
    await this.createCheckpoint(nextTask, "ship", "Commit");
    return nextRun;
  }

  async openTaskPr(workspaceDir: string, taskId: string, baseBranch?: string, message?: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task?.worktreePath) {
      throw new Error("Task worktree not found");
    }
    const result = await this.opencodeService.gitCommit(task.worktreePath, {
      includeUnstaged: true,
      message,
      baseBranch,
      nextStep: "commit_and_create_pr",
    } satisfies GitCommitRequest);
    const run = this.listRunsInternal(normalized).find((candidate) => candidate.id === task.latestRunId) ?? this.createRun(task);
    const nextRun = this.upsertRun({
      ...run,
      status: "completed",
      shipStatus: "pr_opened",
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [...run.logs, {
        id: randomUUID(),
        kind: "ship",
        message: result.prUrl ? `Opened PR ${result.prUrl}` : "Opened PR",
        timestamp: Date.now(),
        }],
      });
    const nextTask = this.upsertTask({
      ...task,
      shipStatus: "pr_opened",
      columnId: "done",
      statusSummary: "completed",
      latestActivityKind: "ship",
      latestPreview: "Opened pull request",
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    this.syncRuntimeForTask(nextTask, { status: "completed", lastEventSummary: "Opened pull request", latestActivityKind: "ship", latestPreview: "Opened pull request" });
    this.syncWorktreeForTask(nextTask, { status: "ready", latestActivityKind: "ship", latestPreview: "Opened pull request" });
    await this.createCheckpoint(nextTask, "ship", "Open PR");
    return nextRun;
  }

  async listRuns(workspaceDir: string) {
    return this.listRunsInternal(path.resolve(workspaceDir));
  }

  async getRun(workspaceDir: string, runId: string) {
    return this.listRunsInternal(path.resolve(workspaceDir)).find((run) => run.id === runId) ?? null;
  }

  async getTaskDetail(workspaceDir: string, taskId: string): Promise<KanbanTaskDetail> {
    const normalized = path.resolve(workspaceDir);
    let task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    task = await this.refreshTask(task);
    const runtime = this.getTaskRuntimeInternal(normalized, taskId);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.taskId === taskId) ?? null;
    const run = task.latestRunId ? this.listRunsInternal(normalized).find((candidate) => candidate.id === task.latestRunId) ?? null : null;
    const dependencies = this.listDependencies(normalized).filter((dep) => dep.fromTaskId === taskId || dep.toTaskId === taskId);
    const reviewComments = this.listReviewComments(normalized, taskId);
    const checkpoints = this.listCheckpointsInternal(normalized, taskId);
    let diff = "No local changes.";
    let structuredDiff: KanbanDiffFile[] = [];
    let transcript: KanbanTaskDetail["transcript"] = [];
    if (task.worktreePath) {
      diff = await this.opencodeService.gitDiff(task.worktreePath).catch((error) => sanitizeError(error));
      structuredDiff = parseUnifiedDiff(diff);
    }
    if (task.provider === "opencode" && task.worktreePath && task.providerThreadId) {
      const messages = await this.opencodeService.loadMessages(task.worktreePath, task.providerThreadId).catch(() => []);
      transcript = summarizeSessionBundles(messages);
    } else if (task.provider === "claude" && task.providerThreadId) {
      const messages = await this.claudeChatService.getSessionMessages(task.providerThreadId, task.worktreePath ?? task.workspaceDir).catch(() => []);
      transcript = messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      }));
    } else {
      transcript = (run?.logs ?? []).map((log) => ({
        id: log.id,
        role: "system" as const,
        content: log.message,
        timestamp: log.timestamp,
      }));
    }
    const detail = { task, runtime, worktree, run, dependencies, reviewComments, checkpoints, diff, structuredDiff, transcript };
    this.emitEvent({ type: "kanban.taskDetail", payload: { workspaceDir: normalized, detail } });
    return detail;
  }

  async getTaskRuntime(workspaceDir: string, taskId: string) {
    return this.getTaskRuntimeInternal(path.resolve(workspaceDir), taskId);
  }

  async listWorktrees(workspaceDir: string) {
    return this.listWorktreesInternal(path.resolve(workspaceDir));
  }

  async createWorktree(input: KanbanCreateWorktreeInput) {
    const normalized = path.resolve(input.workspaceDir);
    const created = await this.worktrees.createStandalone(normalized, input.label, input.baseRef);
    const worktree = this.upsertWorktree({
      id: randomUUID(),
      workspaceDir: normalized,
      label: input.label.trim() || path.basename(created.worktreePath),
      provider: input.provider,
      repoRoot: created.repoRoot,
      directory: created.worktreePath,
      branch: created.branch,
      baseRef: created.baseRef,
      status: "ready",
      mergeStatus: "clean",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.emitEvent({ type: "kanban.worktree", payload: { workspaceDir: normalized, worktree } });
    return worktree;
  }

  async openWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }
    await this.opencodeService.openDirectoryIn(worktree.directory, "finder");
    return true;
  }

  async deleteWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }
    if (existsSync(worktree.directory)) {
      await this.commands.runCommand("git", ["-C", worktree.repoRoot, "worktree", "remove", "--force", worktree.directory], worktree.repoRoot).catch(() => undefined);
    }
    this.database.prepare(`DELETE FROM kanban_worktrees WHERE workspace_dir = ? AND id = ?`).run(normalized, worktreeId);
    return true;
  }

  async getWorktreeStatus(workspaceDir: string, worktreeId: string): Promise<KanbanWorktreeStatusDetail> {
    const normalized = path.resolve(workspaceDir);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }
    const gitState = await this.getGitState(worktree.directory);
    const conflictsRaw = await this.commands.runCommandWithOutput("git", ["-C", worktree.directory, "diff", "--name-only", "--diff-filter=U"], worktree.directory).catch(() => "");
    const conflicts = conflictsRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const hasChanges = Boolean(gitState.statusText.trim());
    const detail = {
      worktree: this.upsertWorktree({
        ...worktree,
        status: conflicts.length > 0 ? "conflicted" : hasChanges ? "active" : worktree.status,
        mergeStatus: conflicts.length > 0 ? "conflicted" : worktree.mergeStatus,
        updatedAt: Date.now(),
      }),
      gitState,
      conflicts,
      hasChanges,
    } satisfies KanbanWorktreeStatusDetail;
    this.emitEvent({ type: "kanban.worktree", payload: { workspaceDir: normalized, worktree: detail.worktree, detail } });
    return detail;
  }

  async mergeWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }
    await this.opencodeService.gitCheckoutBranch(worktree.repoRoot, worktree.baseRef);
    try {
      await this.commands.runCommand("git", ["-C", worktree.repoRoot, "merge", "--no-ff", worktree.branch], worktree.repoRoot);
    } catch {
      const conflictDetail = await this.getWorktreeStatus(normalized, worktreeId);
      const next = this.upsertWorktree({ ...conflictDetail.worktree, status: "conflicted", mergeStatus: "conflicted", updatedAt: Date.now() });
      const task = next.taskId ? this.listTasks(normalized).find((entry) => entry.id === next.taskId) : null;
      if (task) {
        this.upsertTask({ ...task, mergeStatus: "conflicted", latestActivityKind: "merge", latestPreview: "Merge conflicts need resolution", updatedAt: Date.now() });
        this.syncRuntimeForTask(task, { mergeStatus: "conflicted", latestActivityKind: "merge", latestPreview: "Merge conflicts need resolution" });
      }
      return { ...conflictDetail, worktree: next };
    }
    const next = this.upsertWorktree({ ...worktree, status: "merged", mergeStatus: "merged", updatedAt: Date.now() });
    const task = next.taskId ? this.listTasks(normalized).find((entry) => entry.id === next.taskId) : null;
    if (task) {
      const nextTask = this.upsertTask({ ...task, shipStatus: "merged", mergeStatus: "merged", latestActivityKind: "merge", latestPreview: `Merged ${next.branch} into ${next.baseRef}`, updatedAt: Date.now(), completedAt: task.completedAt ?? Date.now() });
      this.syncRuntimeForTask(nextTask, { status: "completed", mergeStatus: "merged", latestActivityKind: "merge", latestPreview: `Merged ${next.branch} into ${next.baseRef}` });
    }
    return this.getWorktreeStatus(normalized, worktreeId);
  }

  async resolveMergeWithAgent(workspaceDir: string, worktreeId: string, provider: KanbanProvider = "opencode") {
    const normalized = path.resolve(workspaceDir);
    const worktree = this.listWorktreesInternal(normalized).find((entry) => entry.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }
    const detail = await this.getWorktreeStatus(normalized, worktreeId);
    const task = worktree.taskId
      ? this.listTasks(normalized).find((entry) => entry.id === worktree.taskId) ?? null
      : await this.createTask({
        workspaceDir: normalized,
        title: `Resolve merge for ${worktree.label}`,
        prompt: `Resolve merge conflicts in worktree ${worktree.directory} and prepare it to merge cleanly into ${worktree.baseRef}. Conflicted files: ${detail.conflicts.join(", ") || "unknown"}`,
        description: "Generated to resolve a worktree merge conflict",
        provider,
        columnId: "review",
      });
    if (!task) {
      throw new Error("Unable to create merge-resolution task");
    }
    await this.sendReviewFeedback(normalized, task.id, `Resolve merge conflicts for worktree ${worktree.branch}. Conflicted files: ${detail.conflicts.join(", ") || "unknown"}.`);
    return this.listTasks(normalized).find((entry) => entry.id === task.id)!;
  }

  async createWorktreeIncludeFromGitignore(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir);
    const repoRoot = await this.resolveRepoRoot(normalized);
    const include = this.worktrees.createWorktreeIncludeFromGitignore(repoRoot);
    return this.upsertSettings({
      ...this.getSettingsInternal(normalized),
      workspaceDir: normalized,
      worktreeInclude: include,
      updatedAt: Date.now(),
    });
  }

  async runScriptShortcut(workspaceDir: string, taskId: string, shortcutId: string): Promise<KanbanScriptShortcutResult> {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const settings = this.getSettingsInternal(normalized);
    const shortcut = settings.scriptShortcuts.find((entry) => entry.id === shortcutId);
    if (!shortcut) {
      throw new Error("Shortcut not found");
    }
    const cwd = task.worktreePath ?? task.workspaceDir;
    try {
      const output = await this.commands.runCommandWithOutput("zsh", ["-lc", shortcut.command], cwd);
      const result = { shortcutId, command: shortcut.command, cwd, ok: true, exitCode: 0, output, createdAt: Date.now() } satisfies KanbanScriptShortcutResult;
      this.emitEvent({ type: "kanban.shortcut", payload: { workspaceDir: normalized, taskId, result } });
      return result;
    } catch (error) {
      const result = { shortcutId, command: shortcut.command, cwd, ok: false, exitCode: 1, output: sanitizeError(error), createdAt: Date.now() } satisfies KanbanScriptShortcutResult;
      this.emitEvent({ type: "kanban.shortcut", payload: { workspaceDir: normalized, taskId, result } });
      return result;
    }
  }

  async listCheckpoints(workspaceDir: string, taskId: string) {
    return this.listCheckpointsInternal(path.resolve(workspaceDir), taskId);
  }

  async createManualCheckpoint(workspaceDir: string, taskId: string, label?: string) {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return this.createCheckpoint(task, "manual", label?.trim() || "Manual checkpoint");
  }

  async getCheckpointDiff(workspaceDir: string, taskId: string, fromCheckpointId: string, toCheckpointId?: string): Promise<KanbanCheckpointDiff> {
    const normalized = path.resolve(workspaceDir);
    const checkpoints = this.listCheckpointsInternal(normalized, taskId);
    const fromCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === fromCheckpointId);
    if (!fromCheckpoint) {
      throw new Error("Checkpoint not found");
    }
    const toCheckpoint = toCheckpointId ? checkpoints.find((checkpoint) => checkpoint.id === toCheckpointId) : undefined;
    const raw = toCheckpoint?.diffRaw ?? fromCheckpoint.diffRaw;
    return {
      workspaceDir: normalized,
      taskId,
      fromCheckpointId,
      toCheckpointId,
      raw,
      files: parseUnifiedDiff(raw),
    };
  }

  async getTaskTerminal(workspaceDir: string, taskId: string) {
    const runtime = this.getTaskRuntimeInternal(path.resolve(workspaceDir), taskId);
    if (!runtime?.terminalId) {
      return null;
    }
    return this.terminalService.listPtys(path.resolve(workspaceDir), "kanban").find((terminal) => terminal.id === runtime.terminalId) ?? null;
  }

  async createTaskTerminal(workspaceDir: string, taskId: string): Promise<KanbanTaskTerminal> {
    const normalized = path.resolve(workspaceDir);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return this.ensureTaskTerminal(task);
  }

  async connectTaskTerminal(workspaceDir: string, taskId: string) {
    const terminal = await this.getTaskTerminal(workspaceDir, taskId);
    if (!terminal) {
      throw new Error("Task terminal not found");
    }
    return this.terminalService.connectPty(path.resolve(workspaceDir), terminal.id);
  }

  async closeTaskTerminal(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir);
    const runtime = this.getTaskRuntimeInternal(normalized, taskId);
    if (!runtime?.terminalId) {
      return true;
    }
    this.terminalService.closePty(normalized, runtime.terminalId);
    const task = this.listTasks(normalized).find((candidate) => candidate.id === taskId);
    if (task) {
      this.syncRuntimeForTask(task, { terminalId: undefined });
    }
    return true;
  }

  async getGitState(workspaceDir: string): Promise<KanbanGitState> {
    const normalized = path.resolve(workspaceDir);
    const repoRoot = await this.resolveRepoRoot(normalized);
    const branchState = await this.opencodeService.gitBranches(repoRoot);
    const statusText = await this.opencodeService.gitStatus(repoRoot);
    const commitsRaw = await this.commands.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "log", "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e", "-n", "40"],
      repoRoot,
    ).catch(() => "");
    const commits = commitsRaw
      .split("\u001e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, shortHash, author, relativeTime, ...subjectParts] = entry.split("\u001f");
        return {
          hash: hash ?? "",
          shortHash: shortHash ?? "",
          author: author ?? "",
          relativeTime: relativeTime ?? "",
          subject: subjectParts.join("\u001f") || shortHash || hash || "",
        } satisfies KanbanGitCommitEntry;
      });
    const graphText = await this.commands.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "log", "--graph", "--oneline", "--decorate", "-n", "40"],
      repoRoot,
    ).catch(() => "");
    return { workspaceDir: normalized, repoRoot, branchState, statusText, commits, graphText };
  }

  async gitFetch(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir));
    await this.commands.runCommand("git", ["-C", repoRoot, "fetch", "--all", "--prune"], repoRoot);
    return this.getGitState(repoRoot);
  }

  async gitPull(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir));
    await this.commands.runCommand("git", ["-C", repoRoot, "pull", "--ff-only"], repoRoot);
    return this.getGitState(repoRoot);
  }

  async gitPush(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir));
    await this.commands.runCommand("git", ["-C", repoRoot, "push"], repoRoot);
    return this.getGitState(repoRoot);
  }

  async gitCheckout(workspaceDir: string, branch: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir));
    await this.opencodeService.gitCheckoutBranch(repoRoot, branch);
    return this.getGitState(repoRoot);
  }

  async startManagementSession(workspaceDir: string, provider?: KanbanProvider) {
    const normalized = path.resolve(workspaceDir);
    const resolvedProvider = provider ?? this.getSettingsInternal(normalized).defaultProvider;
    const existing = this.getManagementSessionInternal(normalized, resolvedProvider);
    if (existing) {
      return existing;
    }
    if (resolvedProvider === "opencode") {
      const session = await this.opencodeService.createSession(normalized, "Kanban board manager");
      return this.upsertManagementSession({
        workspaceDir: normalized,
        provider: resolvedProvider,
        sessionKey: session.id,
        status: "idle",
        transcript: [],
        updatedAt: Date.now(),
      });
    }
    if (resolvedProvider === "codex") {
      const thread = await this.codexService.startThread({ cwd: normalized, title: "Kanban board manager" });
      return this.upsertManagementSession({
        workspaceDir: normalized,
        provider: resolvedProvider,
        sessionKey: thread.id,
        providerThreadId: thread.id,
        status: "idle",
        transcript: [],
        updatedAt: Date.now(),
      });
    }
    return this.upsertManagementSession({
      workspaceDir: normalized,
      provider: resolvedProvider,
      sessionKey: `kanban:management:${slugify(normalized)}`,
      status: "idle",
      transcript: [],
      updatedAt: Date.now(),
    });
  }

  async getManagementSession(workspaceDir: string, provider: KanbanProvider) {
    return this.getManagementSessionInternal(path.resolve(workspaceDir), provider);
  }

  private async applyManagementOperations(workspaceDir: string, operations: KanbanManagementOperation[]) {
    const applied: KanbanManagementPromptResult["applied"] = [];
    for (const [index, operation] of operations.entries()) {
      try {
        if (operation.type === "create_task") {
          const createdTask = await this.createTask({
            workspaceDir,
            title: operation.title,
            prompt: operation.prompt,
            description: operation.description,
            provider: operation.provider ?? this.getSettingsInternal(workspaceDir).defaultProvider,
            columnId: operation.columnId ?? "backlog",
            autoStartWhenUnblocked: operation.autoStartWhenUnblocked,
          });
          if (operation.columnId === "ready") {
            await this.moveTask({ workspaceDir, taskId: createdTask.id, columnId: "ready", position: 0 });
          }
        } else if (operation.type === "update_task") {
          await this.updateTask({
            workspaceDir,
            id: operation.taskId,
            title: operation.title,
            prompt: operation.prompt,
            description: operation.description,
            provider: operation.provider,
            autoStartWhenUnblocked: operation.autoStartWhenUnblocked,
          });
        } else if (operation.type === "link_tasks") {
          await this.linkTasks(workspaceDir, operation.fromTaskId, operation.toTaskId);
        } else if (operation.type === "unlink_tasks") {
          await this.unlinkTasks(workspaceDir, operation.fromTaskId, operation.toTaskId);
        } else if (operation.type === "start_task") {
          await this.startTask(workspaceDir, operation.taskId);
        } else if (operation.type === "resume_task") {
          await this.resumeTask(workspaceDir, operation.taskId);
        } else if (operation.type === "stop_task") {
          await this.stopTask(workspaceDir, operation.taskId);
        } else if (operation.type === "trash_task") {
          await this.trashTask(workspaceDir, operation.taskId);
        } else if (operation.type === "restore_task") {
          await this.restoreTask(workspaceDir, operation.taskId);
        } else if (operation.type === "delete_task") {
          await this.deleteTask(workspaceDir, operation.taskId);
        } else if (operation.type === "create_worktree") {
          await this.createWorktree({ workspaceDir, label: operation.label, baseRef: operation.baseRef });
        } else if (operation.type === "merge_worktree") {
          await this.mergeWorktree(workspaceDir, operation.worktreeId);
        } else if (operation.type === "resolve_merge_with_agent") {
          await this.resolveMergeWithAgent(workspaceDir, operation.worktreeId, operation.provider ?? this.getSettingsInternal(workspaceDir).defaultProvider);
        } else if (operation.type === "delete_worktree") {
          await this.deleteWorktree(workspaceDir, operation.worktreeId);
        } else if (operation.type === "run_shortcut") {
          await this.runScriptShortcut(workspaceDir, operation.taskId, operation.shortcutId);
        } else if (operation.type === "create_automation") {
          await this.createAutomationPublic({
            workspaceDir,
            name: operation.name,
            prompt: operation.prompt,
            provider: operation.provider ?? this.getSettingsInternal(workspaceDir).defaultProvider,
            schedule: operation.schedule,
            autoStart: operation.autoStart,
          });
        }
        applied.push({ index, type: operation.type, ok: true });
      } catch (error) {
        applied.push({ index, type: operation.type, ok: false, error: sanitizeError(error) });
      }
    }
    return applied;
  }

  async sendManagementPrompt(workspaceDir: string, provider: KanbanProvider, prompt: string): Promise<KanbanManagementPromptResult> {
    const normalized = path.resolve(workspaceDir);
    const session = await this.startManagementSession(normalized, provider);
    const board = await this.getBoard(normalized);
    const managementPrompt = buildKanbanManagementPrompt({
      workspaceDir: normalized,
      provider,
      prompt,
      board,
      settings: board.settings,
    });
    let nextSession = this.upsertManagementSession({
      ...session,
      status: "running",
      transcript: [...session.transcript, { id: randomUUID(), role: "user", content: prompt.trim(), timestamp: Date.now() }],
      updatedAt: Date.now(),
      lastError: undefined,
    });

    let rawResponse = "";
    try {
      if (provider === "opencode") {
        await this.opencodeService.sendPrompt({
          directory: normalized,
          sessionID: session.sessionKey,
          text: managementPrompt,
          promptSource: "user",
        });
        const messages = await this.opencodeService.loadMessages(normalized, session.sessionKey).catch(() => []);
        rawResponse = summarizeSessionBundles(messages).filter((item) => item.role === "assistant").at(-1)?.content ?? "";
      } else if (provider === "claude") {
        await this.claudeChatService.startTurn(session.sessionKey, normalized, managementPrompt);
        const state = await this.claudeChatService.getState(session.sessionKey);
        const messages = state.providerThreadId
          ? await this.claudeChatService.getSessionMessages(state.providerThreadId, normalized).catch(() => [])
          : [];
        rawResponse = messages.filter((item) => item.role === "assistant").at(-1)?.content ?? "";
        nextSession = this.upsertManagementSession({
          ...nextSession,
          providerThreadId: state.providerThreadId,
          updatedAt: Date.now(),
        });
      } else {
        rawResponse = await this.codexService.captureAssistantReply(session.sessionKey, managementPrompt, normalized).catch(() => "");
      }
    } catch (error) {
      nextSession = this.upsertManagementSession({
        ...nextSession,
        status: "error",
        lastError: sanitizeError(error),
        updatedAt: Date.now(),
      });
      return { session: nextSession, rawResponse: "", operations: [], applied: [] };
    }

    let operations: KanbanManagementOperation[] = [];
    if (rawResponse.trim()) {
      try {
        operations = parseKanbanManagementResponse(rawResponse).operations;
      } catch {
        operations = [];
      }
    }
    const applied = await this.applyManagementOperations(normalized, operations);
    nextSession = this.upsertManagementSession({
      ...nextSession,
      status: "idle",
      transcript: rawResponse.trim()
        ? [...nextSession.transcript, { id: randomUUID(), role: "assistant", content: rawResponse.trim(), timestamp: Date.now() }]
        : nextSession.transcript,
      updatedAt: Date.now(),
    });
    this.emitEvent({ type: "kanban.management", payload: { workspaceDir: normalized, session: nextSession } });
    return { session: nextSession, rawResponse, operations, applied };
  }

  private isAutomationDue(automation: KanbanAutomation, now: number) {
    if (!automation.enabled) {
      return false;
    }
    if (automation.schedule.type === "interval") {
      const intervalMs = Math.max(5, automation.schedule.intervalMinutes) * 60_000;
      return !automation.lastRunAt || now - automation.lastRunAt >= intervalMs;
    }
    const day = new Date(now).getDay();
    if (!automation.schedule.days.includes(day)) {
      return false;
    }
    const [hoursRaw, minutesRaw] = automation.schedule.time.split(":");
    const targetMinutes = (Number(hoursRaw) || 0) * 60 + (Number(minutesRaw) || 0);
    const date = new Date(now);
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    if (currentMinutes < targetMinutes) {
      return false;
    }
    if (!automation.lastRunAt) {
      return true;
    }
    const last = new Date(automation.lastRunAt);
    return last.getFullYear() !== date.getFullYear()
      || last.getMonth() !== date.getMonth()
      || last.getDate() !== date.getDate()
      || (last.getHours() * 60 + last.getMinutes()) < targetMinutes;
  }

  private async runAutomation(automation: KanbanAutomation) {
    const task = await this.createTask({
      workspaceDir: automation.workspaceDir,
      title: automation.name,
      prompt: automation.prompt,
      description: "Generated from automation",
      provider: automation.provider,
      columnId: automation.autoStart ? "ready" : "backlog",
      autoStartWhenUnblocked: false,
    });
    const updatedAutomation = { ...automation, lastRunAt: Date.now(), updatedAt: Date.now() };
    this.createAutomation(updatedAutomation);
    if (automation.autoStart) {
      const startedTask = await this.startTask(automation.workspaceDir, task.id);
      return this.listRunsInternal(automation.workspaceDir).find((run) => run.id === startedTask.latestRunId)!;
    }
    const run: KanbanRun = {
      id: randomUUID(),
      workspaceDir: automation.workspaceDir,
      automationId: automation.id,
      taskId: task.id,
      provider: automation.provider,
      status: "completed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [{
        id: randomUUID(),
        kind: "system",
        message: `Created task ${task.title} from automation`,
        timestamp: Date.now(),
      }],
    };
    return this.upsertRun(run);
  }

  async runAutomationNow(workspaceDir: string, automationId: string) {
    const automation = this.listAutomationsInternal(path.resolve(workspaceDir)).find((candidate) => candidate.id === automationId);
    if (!automation) {
      throw new Error("Automation not found");
    }
    return this.runAutomation(automation);
  }

  private async runSchedulerTick() {
    if (this.schedulerRunning) {
      return;
    }
    this.schedulerRunning = true;
    try {
      for (const workspace of this.listWorkspacesInternal()) {
        await this.refreshWorkspace(workspace.directory).catch(() => undefined);
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  private async evaluateDueAutomations(workspaceDir: string) {
    const now = Date.now();
    const due = this.listAutomationsInternal(workspaceDir).filter((automation) => this.isAutomationDue(automation, now));
    for (const automation of due) {
      await this.runAutomation(automation).catch(() => undefined);
    }
  }

  private async tryAutoStartUnblocked(workspaceDir: string) {
    const tasks = this.withBlocked(this.listTasks(workspaceDir), this.listDependencies(workspaceDir));
    for (const task of tasks) {
      if (!task.blocked && task.autoStartWhenUnblocked && task.statusSummary === "idle") {
        await this.startTask(workspaceDir, task.id).catch(() => undefined);
      }
    }
  }

  handleEvent(event: OrxaEvent) {
    // Runtime reads remain authoritative; event handling only nudges freshness.
    if (
      event.type === "kanban.board"
      || event.type === "kanban.task"
      || event.type === "kanban.run"
      || event.type === "kanban.runtime"
      || event.type === "kanban.checkpoint"
      || event.type === "kanban.management"
    ) {
      return;
    }
    const payload = asRecord(event.payload);
    const directory = asString(payload?.directory ?? payload?.workspaceDir).trim();
    if (directory) {
      void this.refreshWorkspace(directory).then(async () => {
        const snapshot = await this.getBoard(directory);
        this.emitEvent({ type: "kanban.board", payload: { workspaceDir: directory, snapshot } });
      }).catch(() => undefined);
    }
  }
}
