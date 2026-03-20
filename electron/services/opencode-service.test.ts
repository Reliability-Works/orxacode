/** @vitest-environment node */

import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { hasRecentMatchingUserPrompt } from "./prompt-dedupe";
import { buildManagedServerEnv, OpencodeService, resolveManagedServerLaunchPort, sanitizeManagedRuntimeConfig } from "./opencode-service";
import { createSessionMessageBundle, createTextPart } from "../../src/test/session-message-bundle-factory";

vi.mock("electron", () => ({
  app: {
    getName: () => "Orxa Code Test",
    getPath: () => "/tmp/orxa-opencode-service-test",
  },
}));


describe("hasRecentMatchingUserPrompt", () => {
  it("detects a matching recent user prompt", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "assistant-1",
        role: "assistant",
        sessionID: "s-1",
        createdAt: now - 1_000,
        parts: [],
      }),
      createSessionMessageBundle({
        id: "user-1",
        role: "user",
        sessionID: "s-1",
        createdAt: now + 400,
        parts: [
          createTextPart({
            id: "part-user-1",
            sessionID: "s-1",
            messageID: "user-1",
            text: "build me a website",
          }),
        ],
      }),
    ];

    expect(hasRecentMatchingUserPrompt(messages, "build me a website", now)).toBe(true);
  });

  it("ignores stale or non-matching user prompts", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "user-stale",
        role: "user",
        sessionID: "s-1",
        createdAt: now - 15_000,
        parts: [
          createTextPart({
            id: "part-user-stale",
            sessionID: "s-1",
            messageID: "user-stale",
            text: "build me a website",
          }),
        ],
      }),
      createSessionMessageBundle({
        id: "user-new",
        role: "user",
        sessionID: "s-1",
        createdAt: now + 500,
        parts: [
          createTextPart({
            id: "part-user-new",
            sessionID: "s-1",
            messageID: "user-new",
            text: "different message",
          }),
        ],
      }),
    ];

    expect(hasRecentMatchingUserPrompt(messages, "build me a website", now)).toBe(false);
  });
});

describe("OpencodeService memory prompt integration", () => {
  function createSendPromptHarness() {
    const service = Object.create(OpencodeService.prototype) as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string }) => Promise<boolean>;
      promptFence: Map<string, number>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: (directory: string, text: string) => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
      ensureWorkspaceDirectory: (directory: string) => string;
    };
    service.promptFence = new Map<string, number>();
    service.ensureWorkspaceDirectory = (directory) => directory;
    return service;
  }

  it("injects memory context into prompt system field", async () => {
    const service = createSendPromptHarness();
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    const buildContextMock = vi.fn(async () => "Workspace memory guidance:\nUse pnpm.");
    const scheduleMock = vi.fn(async () => undefined);
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: buildContextMock,
    };
    service.scheduleSessionMemoryIngest = scheduleMock;

    await service.sendPrompt({
      directory: "/repo-memory",
      sessionID: "session-1",
      text: "Run tests",
    });

    const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined;
    expect(buildContextMock).toHaveBeenCalledWith("/repo-memory", "Run tests");
    expect(payload?.system).toContain("Workspace memory guidance");
  });

  it("omits system field when no memory context exists", async () => {
    const service = createSendPromptHarness() as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string }) => Promise<boolean>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: () => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
    };
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: async () => "",
    };
    service.scheduleSessionMemoryIngest = async () => undefined;

    await service.sendPrompt({
      directory: "/repo-standard",
      sessionID: "session-2",
      text: "No memory",
    });

    const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined;
    expect(payload?.system).toBeUndefined();
  });

  it("forwards explicit tool policy overrides in prompt payload", async () => {
    const service = createSendPromptHarness() as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string; tools?: Record<string, boolean> }) => Promise<boolean>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: () => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
    };
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: async () => "",
    };
    service.scheduleSessionMemoryIngest = async () => undefined;

    await service.sendPrompt({
      directory: "/repo-standard",
      sessionID: "session-3",
      text: "Use ORXA browser actions only",
      tools: { "*": false, web_search: false },
    });

    const payload = promptMock.mock.calls[0]?.[0] as { tools?: Record<string, boolean> } | undefined;
    expect(payload?.tools).toEqual({ "*": false, web_search: false });
  });

  it("skips memory-context lookup for machine-origin prompts", async () => {
    const service = createSendPromptHarness() as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string; promptSource?: "machine" | "user" }) => Promise<boolean>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: () => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
    };
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    const buildContextMock = vi.fn(async () => "Workspace memory guidance");
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: buildContextMock,
    };
    service.scheduleSessionMemoryIngest = async () => undefined;

    await service.sendPrompt({
      directory: "/repo-standard",
      sessionID: "session-4",
      text: "[ORXA_BROWSER_RESULT]{}",
      promptSource: "machine",
    });

    expect(buildContextMock).not.toHaveBeenCalled();
    const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined;
    expect(payload?.system).toBeUndefined();
  });
});

describe("OpencodeService provider filtering", () => {
  it("keeps credential-backed and env-backed providers while excluding unauthenticated catalog entries", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      listProviders: (directory?: string) => Promise<{ all: Array<{ id: string }>; connected: string[]; default: Record<string, string> }>;
      client: () => { provider: { list: () => Promise<{ data: unknown }> } };
      listAuthenticatedProviderIDs: () => Promise<Set<string>>;
      providerHasSatisfiedEnv: (provider: unknown) => boolean;
    };

    service.client = () => ({
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "google", name: "Google", env: ["GEMINI_API_KEY"], models: { gemini: { id: "gemini" } } },
              { id: "zai-coding-plan", name: "Z.AI Coding Plan", env: ["ZHIPU_API_KEY"], models: { glm: { id: "glm" } } },
              { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], models: { sonnet: { id: "sonnet" } } },
            ],
            connected: ["google"],
            default: {
              google: "gemini",
              "zai-coding-plan": "glm",
              anthropic: "sonnet",
            },
          },
        }),
      },
    });
    service.listAuthenticatedProviderIDs = async () => new Set(["zai-coding-plan"]);
    service.providerHasSatisfiedEnv = (provider) => {
      const id = (provider as { id?: string }).id;
      return id === "google";
    };

    const providers = await service.listProviders();

    expect(providers.all.map((provider) => provider.id)).toEqual(["google", "zai-coding-plan"]);
    expect(providers.connected).toEqual(["google", "zai-coding-plan"]);
    expect(providers.default).toEqual({
      google: "gemini",
      "zai-coding-plan": "glm",
    });
  });

  it("treats a provider as env-authenticated when any supported env key is present", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      providerHasSatisfiedEnv: (provider: unknown) => boolean;
    };

    const previousApiToken = process.env.CLOUDFLARE_API_TOKEN;
    const previousAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const previousGatewayId = process.env.CLOUDFLARE_GATEWAY_ID;
    process.env.CLOUDFLARE_API_TOKEN = "configured";
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_GATEWAY_ID;

    try {
      expect(service.providerHasSatisfiedEnv({
        id: "cloudflare-ai-gateway",
        env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
      })).toBe(true);
    } finally {
      if (previousApiToken === undefined) {
        delete process.env.CLOUDFLARE_API_TOKEN;
      } else {
        process.env.CLOUDFLARE_API_TOKEN = previousApiToken;
      }
      if (previousAccountId === undefined) {
        delete process.env.CLOUDFLARE_ACCOUNT_ID;
      } else {
        process.env.CLOUDFLARE_ACCOUNT_ID = previousAccountId;
      }
      if (previousGatewayId === undefined) {
        delete process.env.CLOUDFLARE_GATEWAY_ID;
      } else {
        process.env.CLOUDFLARE_GATEWAY_ID = previousGatewayId;
      }
    }
  });
});

describe("OpencodeService git flows", () => {
  it("includes untracked file line counts in commit summary", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommitSummary: (directory: string, includeUnstaged: boolean) => Promise<{
        filesChanged: number;
        insertions: number;
        deletions: number;
      }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      gitDiff: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/new-file");
    service.gitDiff = vi.fn(async () =>
      [
        "## Untracked",
        "",
        "diff --git a/src/new.ts b/src/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1,3 @@",
        "+const a = 1;",
        "+const b = 2;",
        "+const c = 3;",
      ].join("\n"),
    );
    service.runCommandWithOutput = vi.fn(async () => "");

    const summary = await service.gitCommitSummary("/repo", true);

    expect(summary.filesChanged).toBe(1);
    expect(summary.insertions).toBe(3);
    expect(summary.deletions).toBe(0);
  });

  it("passes requested base branch to gh when creating pull requests", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommit: (directory: string, request: {
        includeUnstaged: boolean;
        message?: string;
        guidancePrompt?: string;
        baseBranch?: string;
        nextStep: "commit" | "commit_and_push" | "commit_and_create_pr";
      }) => Promise<{ prUrl?: string }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      resolveCommandPath: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/commit-flow");
    service.resolveCommandPath = vi.fn(async () => "gh");
    service.runCommand = vi.fn(async () => undefined);
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("diff --cached --name-only")) {
        return "src/app.ts\n";
      }
      if (full.includes("rev-parse HEAD")) {
        return "abc1234\n";
      }
      if (full.includes("pr create")) {
        return "https://github.com/anomalyco/opencode/pull/42\n";
      }
      return "";
    });

    const result = await service.gitCommit("/repo", {
      includeUnstaged: false,
      message: "feat: improve commit modal",
      nextStep: "commit_and_create_pr",
      baseBranch: "main",
    });

    expect(result.prUrl).toBe("https://github.com/anomalyco/opencode/pull/42");
    expect(service.runCommandWithOutput).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--fill", "--head", "feature/commit-flow", "--base", "main"],
      "/repo",
    );
  });

  it("omits bare origin namespace entries from branch list", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitBranches: (directory: string) => Promise<{
        current: string;
        branches: string[];
      }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feat/driving-4-us");
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("refs/heads")) {
        return ["feat/driving-4-us", "main"].join("\n");
      }
      if (full.includes("refs/remotes/origin")) {
        return ["origin", "origin/HEAD", "origin/main", "origin/feat/first-response-nextjs"].join("\n");
      }
      return "";
    });

    const result = await service.gitBranches("/repo");
    expect(result.current).toBe("feat/driving-4-us");
    expect(result.branches).toEqual(["feat/driving-4-us", "feat/first-response-nextjs", "main"]);
    expect(result.branches).not.toContain("origin");
  });

  it("checks out an existing local branch without trying to create it", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCheckoutBranch: (directory: string, branch: string) => Promise<{
        current: string;
        branches: string[];
      }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      gitBranches: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.runCommand = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("show-ref --verify --quiet refs/heads/staging")) {
        return undefined;
      }
      if (full.includes("checkout staging")) {
        return undefined;
      }
      if (full.includes("checkout -b staging")) {
        throw new Error("should not create branch when local branch exists");
      }
      return undefined;
    });
    service.gitBranches = vi.fn(async () => ({
      current: "staging",
      branches: ["main", "staging"],
    }));

    const result = await service.gitCheckoutBranch("/repo", "staging");
    expect(result.current).toBe("staging");
    expect(service.runCommand).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "checkout", "staging"],
      "/repo",
    );
  });

  it("falls back to checkout when branch creation reports that the branch already exists", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCheckoutBranch: (directory: string, branch: string) => Promise<{
        current: string;
        branches: string[];
      }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      gitBranches: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.runCommand = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("show-ref --verify --quiet refs/heads/staging")) {
        throw new Error("missing local ref");
      }
      if (full.includes("show-ref --verify --quiet refs/remotes/origin/staging")) {
        throw new Error("missing remote ref");
      }
      if (full.includes("checkout -b staging")) {
        throw new Error("fatal: a branch named 'staging' already exists");
      }
      if (full.includes("checkout staging")) {
        return undefined;
      }
      return undefined;
    });
    service.gitBranches = vi.fn(async () => ({
      current: "staging",
      branches: ["main", "staging"],
    }));

    const result = await service.gitCheckoutBranch("/repo", "staging");
    expect(result.current).toBe("staging");
    expect(service.runCommand).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "checkout", "staging"],
      "/repo",
    );
  });

  it("retries PR creation without --fill when git range defaults cannot be computed", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommit: (directory: string, request: {
        includeUnstaged: boolean;
        message?: string;
        guidancePrompt?: string;
        baseBranch?: string;
        nextStep: "commit" | "commit_and_push" | "commit_and_create_pr";
      }) => Promise<{ prUrl?: string }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      resolveCommandPath: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/commit-flow");
    service.resolveCommandPath = vi.fn(async () => "gh");
    service.runCommand = vi.fn(async () => undefined);
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("diff --cached --name-only")) {
        return "src/app.ts\n";
      }
      if (full.includes("rev-parse HEAD")) {
        return "abc1234\n";
      }
      if (full.startsWith("pr create --fill")) {
        throw new Error(
          "gh pr create --fill --head feature/commit-flow --base main exited with code 1: could not compute title or body defaults: failed to run git: fatal: ambiguous argument 'main...feature/commit-flow': unknown revision or path not in the working tree.",
        );
      }
      if (full.startsWith("pr create --title")) {
        return "https://github.com/anomalyco/opencode/pull/43\n";
      }
      return "";
    });

    const result = await service.gitCommit("/repo", {
      includeUnstaged: false,
      message: "feat: improve commit modal\n\n- handle fallback for PR creation",
      nextStep: "commit_and_create_pr",
      baseBranch: "main",
    });

    expect(result.prUrl).toBe("https://github.com/anomalyco/opencode/pull/43");
    expect(service.runCommandWithOutput).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--title", "feat: improve commit modal", "--body", "- handle fallback for PR creation", "--head", "feature/commit-flow", "--base", "main"],
      "/repo",
    );
  });

  it("surfaces real gh failures instead of misreporting missing CLI", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommit: (directory: string, request: {
        includeUnstaged: boolean;
        message?: string;
        guidancePrompt?: string;
        baseBranch?: string;
        nextStep: "commit" | "commit_and_push" | "commit_and_create_pr";
      }) => Promise<{ prUrl?: string }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      resolveCommandPath: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/commit-flow");
    service.resolveCommandPath = vi.fn(async () => "gh");
    service.runCommand = vi.fn(async () => undefined);
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("diff --cached --name-only")) {
        return "src/app.ts\n";
      }
      if (full.includes("rev-parse HEAD")) {
        return "abc1234\n";
      }
      if (full.startsWith("pr create --fill")) {
        throw new Error("gh pr create --fill --head feature/commit-flow --base main exited with code 1: pull request create failed: GraphQL: No commits between base and head");
      }
      return "";
    });

    await expect(
      service.gitCommit("/repo", {
        includeUnstaged: false,
        message: "feat: improve commit modal",
        nextStep: "commit_and_create_pr",
        baseBranch: "main",
      }),
    ).rejects.toThrow("Unable to create PR: gh pr create --fill --head feature/commit-flow --base main exited with code 1: pull request create failed: GraphQL: No commits between base and head");
  });

  it("falls back to compare URL when gh is unavailable for create-pr flow", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommit: (directory: string, request: {
        includeUnstaged: boolean;
        message?: string;
        guidancePrompt?: string;
        baseBranch?: string;
        nextStep: "commit" | "commit_and_push" | "commit_and_create_pr";
      }) => Promise<{ prUrl?: string }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      resolveCommandPath: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/commit-flow");
    service.resolveCommandPath = vi.fn(async () => undefined);
    service.runCommand = vi.fn(async () => undefined);
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("diff --cached --name-only")) {
        return "src/app.ts\n";
      }
      if (full.includes("rev-parse HEAD")) {
        return "abc1234\n";
      }
      if (full.includes("remote get-url origin")) {
        return "git@github.com:anomalyco/opencode.git\n";
      }
      if (full.includes("symbolic-ref --quiet --short refs/remotes/origin/HEAD")) {
        return "origin/main\n";
      }
      return "";
    });

    const result = await service.gitCommit("/repo", {
      includeUnstaged: false,
      message: "feat: improve commit modal",
      nextStep: "commit_and_create_pr",
    });

    expect(result.prUrl).toBe("https://github.com/anomalyco/opencode/compare/main...feature%2Fcommit-flow?expand=1");
    expect(service.runCommand).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["-C", "/repo", "commit"]),
      "/repo",
    );
    expect(service.runCommand).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "push"],
      "/repo",
    );
    const prCreateInvoked = service.runCommandWithOutput.mock.calls.some(
      (_call: unknown[]) => Array.isArray(_call[1]) && (_call[1] as string[])[0] === "pr" && (_call[1] as string[])[1] === "create",
    );
    expect(prCreateInvoked).toBe(false);
  });

  it("throws when guided auto-generation fails instead of using generic fallback", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      gitCommit: (directory: string, request: {
        includeUnstaged: boolean;
        message?: string;
        guidancePrompt?: string;
        baseBranch?: string;
        nextStep: "commit" | "commit_and_push" | "commit_and_create_pr";
      }) => Promise<{ prUrl?: string }>;
      resolveGitRepoRoot: ReturnType<typeof vi.fn>;
      currentBranch: ReturnType<typeof vi.fn>;
      collectGitStats: ReturnType<typeof vi.fn>;
      runCommandWithOutput: ReturnType<typeof vi.fn>;
      generateCommitMessageWithAgent: ReturnType<typeof vi.fn>;
      runCommand: ReturnType<typeof vi.fn>;
    };

    service.resolveGitRepoRoot = vi.fn(async () => "/repo");
    service.currentBranch = vi.fn(async () => "feature/commit-flow");
    service.collectGitStats = vi.fn(async () => ({ filesChanged: 3, insertions: 10, deletions: 2 }));
    service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
      const full = args.join(" ");
      if (full.includes("diff --cached --name-only")) {
        return "src/app.ts\n";
      }
      if (full.includes("status --short") || full.includes("diff --compact-summary")) {
        return "M src/app.ts\n";
      }
      return "";
    });
    service.generateCommitMessageWithAgent = vi.fn(async () => undefined);
    service.runCommand = vi.fn(async () => undefined);

    await expect(
      service.gitCommit("/repo", {
        includeUnstaged: false,
        nextStep: "commit",
        guidancePrompt: "Use a strict conventional commit with grouped bullets.",
      }),
    ).rejects.toThrow("Unable to auto-generate commit message. Enter a commit message manually and try again.");

    expect(service.runCommand).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["-C", "/repo", "commit"]),
      "/repo",
    );
  });
});

describe("OpencodeService abortSession", () => {
  it("aborts delegated child sessions before the parent session", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      abortSession: (directory: string, sessionID: string) => Promise<boolean>;
      ensureWorkspaceDirectory: (directory: string) => string;
      loadMessages: (directory: string, sessionID: string) => Promise<ReturnType<typeof createSessionMessageBundle>[]>;
      client: (directory: string) => { session: { abort: (payload: { directory: string; sessionID: string }) => Promise<void> } };
    };

    const now = Date.now();
    const abortMock = vi.fn(async () => undefined);
    service.ensureWorkspaceDirectory = (directory: string) => directory;
    service.client = () => ({
      session: {
        abort: abortMock,
      },
    });
    service.loadMessages = vi.fn(async (_directory: string, sessionID: string) => {
      if (sessionID === "root-session") {
        return [
          createSessionMessageBundle({
            id: "assistant-root",
            role: "assistant",
            sessionID,
            createdAt: now,
            parts: [
              {
                id: "subtask-root",
                type: "subtask",
                sessionID: "child-session",
                messageID: "assistant-root",
                prompt: "Inspect the booking stack.",
                description: "Inspect booking stack",
                agent: "explorer",
                model: { providerID: "openai", modelID: "gpt-5.4" },
              },
            ],
          }),
        ];
      }
      if (sessionID === "child-session") {
        return [
          createSessionMessageBundle({
            id: "assistant-child",
            role: "assistant",
            sessionID,
            createdAt: now + 1,
            parts: [
              {
                id: "subtask-child",
                type: "subtask",
                sessionID: "grandchild-session",
                messageID: "assistant-child",
                prompt: "Inspect the schema.",
                description: "Inspect schema",
                agent: "librarian",
                model: { providerID: "openai", modelID: "gpt-5.4" },
              },
            ],
          }),
        ];
      }
      return [];
    });

    await service.abortSession("/repo", "root-session");

    expect(
      abortMock.mock.calls.map((call: unknown[]) => {
        const payload = call.at(0) as { sessionID: string } | undefined;
        return payload?.sessionID;
      }),
    ).toEqual([
      "grandchild-session",
      "child-session",
      "root-session",
    ]);
  });
});

describe("OpencodeService runtime dependency detection", () => {
  it("marks opencode installed when shell fallback succeeds", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      checkRuntimeDependencies: () => Promise<{
        dependencies: Array<{ key: "opencode" | "orxa"; installed: boolean }>;
      }>;
      canRunCommand: ReturnType<typeof vi.fn>;
      commandPathCandidates: ReturnType<typeof vi.fn>;
      canRunCommandViaLoginShell: ReturnType<typeof vi.fn>;
    };

    service.canRunCommand = vi.fn(async () => false);
    service.commandPathCandidates = vi.fn(async () => []);
    service.canRunCommandViaLoginShell = vi.fn(async (command: string) => command === "opencode");

    const report = await service.checkRuntimeDependencies();
    const opencode = report.dependencies.find((item) => item.key === "opencode");

    expect(opencode?.installed).toBe(true);
    expect(service.canRunCommandViaLoginShell).toHaveBeenCalledWith("opencode", ["--version"], expect.any(String));
  });

  it("marks opencode missing when direct and shell checks fail", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      checkRuntimeDependencies: () => Promise<{
        dependencies: Array<{ key: "opencode" | "orxa"; installed: boolean }>;
      }>;
      canRunCommand: ReturnType<typeof vi.fn>;
      commandPathCandidates: ReturnType<typeof vi.fn>;
      canRunCommandViaLoginShell: ReturnType<typeof vi.fn>;
    };

    service.canRunCommand = vi.fn(async () => false);
    service.commandPathCandidates = vi.fn(async () => []);
    service.canRunCommandViaLoginShell = vi.fn(async () => false);

    const report = await service.checkRuntimeDependencies();
    const opencode = report.dependencies.find((item) => item.key === "opencode");

    expect(opencode?.installed).toBe(false);
  });
});

describe("OpencodeService managed local runtime startup", () => {
  it("starts the managed local runtime instead of attaching to an arbitrary existing server", async () => {
    const service = Object.create(OpencodeService.prototype) as {
      initializeFromStoredProfile: () => Promise<{ status: string }>;
      profileStore: {
        list: () => Array<{ id: string; startCommand: boolean; host: string; port: number; https: boolean }>;
        activeProfileId: () => string | undefined;
      };
      startLocal: ReturnType<typeof vi.fn>;
      attach: ReturnType<typeof vi.fn>;
      runtimeState: () => { status: string };
      setState: (next: unknown) => void;
      managedProcess?: unknown;
    };

    service.profileStore = {
      list: () => [{ id: "local-profile", startCommand: true, host: "127.0.0.1", port: 4096, https: false }],
      activeProfileId: () => "local-profile",
    };
    service.startLocal = vi.fn(async () => ({ status: "connected" }));
    service.attach = vi.fn(async () => ({ status: "connected" }));
    service.runtimeState = () => ({ status: "connected" });
    service.setState = () => undefined;

    const runtime = await service.initializeFromStoredProfile();

    expect(service.startLocal).toHaveBeenCalledWith("local-profile");
    expect(service.attach).not.toHaveBeenCalled();
    expect(runtime.status).toBe("connected");
  });

  it("falls back to an ephemeral port when the preferred managed runtime port is already occupied", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const occupiedPort = (server.address() as { port: number }).port;

    try {
      await expect(resolveManagedServerLaunchPort("127.0.0.1", occupiedPort)).resolves.toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("strips repo-local npm lifecycle variables from the managed server environment", () => {
    const env = buildManagedServerEnv({
      PATH: "/usr/bin",
      HOME: "/Users/test",
      INIT_CWD: "/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa",
      PNPM_SCRIPT_SRC_DIR: "/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa",
      VITE_DEV_SERVER_URL: "http://localhost:5173",
      npm_package_name: "opencode-orxa",
      npm_lifecycle_event: "dev",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/test");
    expect(env.INIT_CWD).toBeUndefined();
    expect(env.PNPM_SCRIPT_SRC_DIR).toBeUndefined();
    expect(env.VITE_DEV_SERVER_URL).toBeUndefined();
    expect(env.npm_package_name).toBeUndefined();
    expect(env.npm_lifecycle_event).toBeUndefined();
  });

  it("removes plugin configuration from the managed runtime config snapshot", () => {
    const raw = JSON.stringify({
      plugin: ["opencode-supermemory", "opencode-sync-plugin"],
      provider: {
        "zai-coding-plan": {
          name: "Z.AI Coding Plan",
        },
      },
    }, null, 2);

    expect(sanitizeManagedRuntimeConfig(raw)).toBe(
      `${JSON.stringify({
        provider: {
          "zai-coding-plan": {
            name: "Z.AI Coding Plan",
          },
        },
      }, null, 2)}\n`,
    );
  });
});
