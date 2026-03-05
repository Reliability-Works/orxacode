/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { updateOrxaPluginInConfigDocument } from "./plugin-config";
import { hasRecentMatchingUserPrompt } from "./prompt-dedupe";
import { OpencodeService } from "./opencode-service";
import type { SessionMessageBundle } from "../../shared/ipc";

vi.mock("electron", () => ({
  app: {
    getName: () => "Opencode Orxa Test",
    getPath: () => "/tmp/orxa-opencode-service-test",
  },
}));

describe("updateOrxaPluginInConfigDocument", () => {
  it("adds Orxa plugin in Orxa mode", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3"
  ]
}\n`;

    const result = updateOrxaPluginInConfigDocument(input, "orxa");
    expect(result.changed).toBe(true);
    expect(result.output).toContain('"example/plugin@1.2.3"');
    expect(result.output).toContain('"@reliabilityworks/opencode-orxa@1.0.43"');
  });

  it("removes Orxa plugin in standard mode and stays idempotent", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3",
    "@reliabilityworks/opencode-orxa@1.0.43"
  ]
}\n`;

    const removed = updateOrxaPluginInConfigDocument(input, "standard");
    expect(removed.changed).toBe(true);
    expect(removed.output).toContain('"example/plugin@1.2.3"');
    expect(removed.output).not.toContain("opencode-orxa");

    const secondPass = updateOrxaPluginInConfigDocument(removed.output, "standard");
    expect(secondPass.changed).toBe(false);
  });
});

describe("hasRecentMatchingUserPrompt", () => {
  it("detects a matching recent user prompt", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "assistant-1",
          role: "assistant",
          sessionID: "s-1",
          time: { created: now - 1_000, updated: now - 1_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [] as SessionMessageBundle["parts"],
      },
      {
        info: ({
          id: "user-1",
          role: "user",
          sessionID: "s-1",
          time: { created: now + 400, updated: now + 400 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-1",
            type: "text",
            sessionID: "s-1",
            messageID: "user-1",
            text: "build me a website",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    expect(hasRecentMatchingUserPrompt(messages, "build me a website", now)).toBe(true);
  });

  it("ignores stale or non-matching user prompts", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "user-stale",
          role: "user",
          sessionID: "s-1",
          time: { created: now - 15_000, updated: now - 15_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-stale",
            type: "text",
            sessionID: "s-1",
            messageID: "user-stale",
            text: "build me a website",
          },
        ] as SessionMessageBundle["parts"],
      },
      {
        info: ({
          id: "user-new",
          role: "user",
          sessionID: "s-1",
          time: { created: now + 500, updated: now + 500 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-new",
            type: "text",
            sessionID: "s-1",
            messageID: "user-new",
            text: "different message",
          },
        ] as SessionMessageBundle["parts"],
      },
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
