import path from "node:path";
import type { GitBranchState, GitCommitRequest, GitCommitResult, GitCommitSummary } from "../../shared/ipc";
import { isGhAuthError, isMissingGhCliError, sanitizeError } from "./opencode-runtime-helpers";

export const DEFAULT_COMMIT_GUIDANCE = [
  "Write a high-quality conventional commit message.",
  "Use this format:",
  "1) First line: <type>(optional-scope): concise summary in imperative mood.",
  "2) Blank line.",
  "3) Body bullets grouped by area, clearly describing what changed and why.",
  "4) Mention notable side effects, risk, and follow-up work if relevant.",
  "5) Keep it specific to the included diff and avoid generic phrasing.",
].join("\n");

export function parseGitPatchStats(output: string) {
  const trimmed = output.trim();
  if (
    !trimmed ||
    trimmed === "No local changes." ||
    trimmed === "Not a git repository." ||
    trimmed.startsWith("Loading diff")
  ) {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }

  let insertions = 0;
  let deletions = 0;
  const changedFiles = new Set<string>();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const diffHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffHeaderMatch) {
      const filePath = diffHeaderMatch[2] ?? diffHeaderMatch[1];
      if (filePath) {
        changedFiles.add(filePath);
      }
      continue;
    }

    const untrackedMatch = line.match(/^\?\?\s+(.+)$/);
    if (untrackedMatch) {
      const filePath = untrackedMatch[1]?.trim();
      if (filePath) {
        changedFiles.add(filePath);
        insertions += 1;
      }
      continue;
    }

    const inlineUntracked = [...line.matchAll(/\?\?\s+([^?]+?)(?=\s+\?\?|$)/g)];
    if (inlineUntracked.length > 0) {
      for (const match of inlineUntracked) {
        const filePath = (match[1] ?? "").trim();
        if (!filePath) {
          continue;
        }
        changedFiles.add(filePath);
        insertions += 1;
      }
      continue;
    }

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      insertions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return {
    filesChanged: changedFiles.size,
    insertions,
    deletions,
  };
}

export function fallbackCommitMessage(stats: { filesChanged: number; insertions: number; deletions: number }) {
  const files = Math.max(stats.filesChanged, 1);
  return [
    `chore: update ${files} file${files === 1 ? "" : "s"}`,
    "",
    `- apply local working tree updates across ${files} file${files === 1 ? "" : "s"}`,
    `- add ${stats.insertions} line${stats.insertions === 1 ? "" : "s"} and remove ${stats.deletions} line${stats.deletions === 1 ? "" : "s"}`,
  ].join("\n");
}

export function toCommitMessageArgs(message: string) {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const blocks = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (blocks.length === 0) {
    return ["-m", normalized];
  }
  const args: string[] = [];
  for (const block of blocks) {
    args.push("-m", block);
  }
  return args;
}

export function normalizeGitHubRemote(remoteUrl: string) {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  let slug: string | undefined;
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    slug = sshMatch[1];
  }

  if (!slug) {
    const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i);
    if (sshProtocolMatch) {
      slug = sshProtocolMatch[1];
    }
  }

  if (!slug) {
    const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i);
    if (httpsMatch) {
      slug = httpsMatch[1];
    }
  }

  if (!slug) {
    return undefined;
  }

  return `https://github.com/${slug.replace(/\.git$/i, "")}`;
}

type BasicDeps = {
  resolveGitRepoRoot: (directory: string) => Promise<string | undefined>;
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
  runCommandWithOutput: (command: string, args: string[], cwd: string) => Promise<string>;
  currentBranch: (repoRoot: string) => Promise<string>;
  collectGitStats: (repoRoot: string, includeUnstaged: boolean) => Promise<{ filesChanged: number; insertions: number; deletions: number }>;
  gitRefExists: (repoRoot: string, ref: string) => Promise<boolean>;
  gitBranches: (directory: string) => Promise<GitBranchState>;
  renderUntrackedDiff: (repoRoot: string, relativePath: string) => Promise<string>;
  resolveCommandPath: (command: string, cwd: string) => Promise<string | undefined>;
  buildManualPrUrl: (repoRoot: string, branch: string, baseBranch?: string) => Promise<string | undefined>;
  toCommitMessageArgs: (message: string) => string[];
  gitGenerateCommitMessage: (
    directory: string,
    includeUnstaged: boolean,
    guidancePrompt: string,
    options?: { requireGeneratedMessage?: boolean },
  ) => Promise<string>;
  pushBranch: (repoRoot: string, branch: string) => Promise<void>;
};

export async function gitDiffWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommandWithOutput" | "renderUntrackedDiff">) {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return "Not a git repository.";
  }
  const unstaged = await deps.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "diff", "--", "."], cwd).catch(
    (error) => `Failed to load unstaged diff: ${sanitizeError(error)}`,
  );
  const staged = await deps.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "diff", "--staged", "--", "."], cwd).catch(
    (error) => `Failed to load staged diff: ${sanitizeError(error)}`,
  );
  const untracked = await deps.runCommandWithOutput(
    "git",
    ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"],
    cwd,
  ).catch((error) => `Failed to load untracked files: ${sanitizeError(error)}`);

  const sections: string[] = [];
  if (unstaged.trim().length > 0) {
    sections.push("## Unstaged\n", unstaged.trimEnd());
  }
  if (staged.trim().length > 0) {
    sections.push("## Staged\n", staged.trimEnd());
  }
  if (untracked.trim().length > 0) {
    const files = untracked
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (files.length > 0) {
      const rendered = await Promise.all(files.map((filePath) => deps.renderUntrackedDiff(repoRoot, filePath)));
      const output = rendered.filter((chunk) => chunk.trim().length > 0).join("\n\n");
      if (output.trim().length > 0) {
        sections.push("## Untracked\n", output);
      }
    }
  }
  if (sections.length === 0) {
    return "No local changes.";
  }
  return sections.join("\n\n");
}

export async function gitLogWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommandWithOutput">) {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return "Not a git repository.";
  }
  const output = await deps.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "log", "--oneline", "--decorate", "-n", "40"], cwd)
    .catch((error) => `Unable to load git log: ${sanitizeError(error)}`);
  return output.trim().length > 0 ? output.trimEnd() : "No commit history found.";
}

export async function gitIssuesWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommandWithOutput">) {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return "Not a git repository.";
  }
  const output = await deps.runCommandWithOutput("gh", ["issue", "list", "--limit", "30"], repoRoot).catch((error) => {
    const message = sanitizeError(error);
    if (isMissingGhCliError(error)) {
      return "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
    }
    return `Unable to load issues: ${message}`;
  });
  return output.trim().length > 0 ? output.trimEnd() : "No open issues.";
}

export async function gitPrsWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommandWithOutput">) {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    return "Not a git repository.";
  }
  const output = await deps.runCommandWithOutput("gh", ["pr", "list", "--limit", "30"], repoRoot).catch((error) => {
    const message = sanitizeError(error);
    if (isMissingGhCliError(error)) {
      return "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
    }
    return `Unable to load pull requests: ${message}`;
  });
  return output.trim().length > 0 ? output.trimEnd() : "No open pull requests.";
}

export async function gitCommitSummaryWorkflow(
  directory: string,
  includeUnstaged: boolean,
  deps: Pick<BasicDeps, "resolveGitRepoRoot" | "currentBranch" | "collectGitStats">,
): Promise<GitCommitSummary> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  const branch = await deps.currentBranch(repoRoot);
  const stats = await deps.collectGitStats(repoRoot, includeUnstaged);
  return {
    repoRoot,
    branch,
    filesChanged: stats.filesChanged,
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

export async function gitGenerateCommitMessageWorkflow(
  directory: string,
  includeUnstaged: boolean,
  guidancePrompt: string,
  options: { requireGeneratedMessage?: boolean } = {},
  deps: Pick<BasicDeps, "resolveGitRepoRoot" | "currentBranch" | "collectGitStats" | "runCommandWithOutput"> & {
    generateCommitMessageWithAgent: (directory: string, prompt: string) => Promise<string | undefined>;
    fallbackCommitMessage: (stats: { filesChanged: number; insertions: number; deletions: number }) => string;
  },
): Promise<string> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  const branch = await deps.currentBranch(repoRoot);
  const stats = await deps.collectGitStats(repoRoot, includeUnstaged);
  const status = await deps.runCommandWithOutput("git", ["-C", repoRoot, "status", "--short"], repoRoot).catch(() => "");
  const diffArgs = includeUnstaged
    ? ["-C", repoRoot, "--no-pager", "diff", "--compact-summary", "HEAD", "--", "."]
    : ["-C", repoRoot, "--no-pager", "diff", "--compact-summary", "--cached", "--", "."];
  const diff = await deps.runCommandWithOutput("git", diffArgs, repoRoot).catch(() => "");
  const payload = [
    "Generate a commit message for this repository update.",
    "",
    "Guidance:",
    guidancePrompt.trim().length > 0 ? guidancePrompt.trim() : DEFAULT_COMMIT_GUIDANCE,
    "",
    `Branch: ${branch}`,
    `Files changed: ${stats.filesChanged}`,
    `Insertions: ${stats.insertions}`,
    `Deletions: ${stats.deletions}`,
    "",
    "git status --short:",
    status.trim().length > 0 ? status.slice(0, 3000) : "(no output)",
    "",
    "git diff summary:",
    diff.trim().length > 0 ? diff.slice(0, 14_000) : "(no output)",
    "",
    "Return only the commit message text, with no markdown fences.",
  ].join("\n");

  const generated = await deps.generateCommitMessageWithAgent(directory, payload).catch(() => undefined);
  if (generated && generated.trim().length > 0) {
    return generated.trim();
  }

  if (options.requireGeneratedMessage) {
    throw new Error("Unable to auto-generate commit message. Enter a commit message manually and try again.");
  }

  return deps.fallbackCommitMessage(stats);
}

export async function gitCommitWorkflow(
  directory: string,
  request: GitCommitRequest,
  deps: Pick<BasicDeps,
    | "resolveGitRepoRoot"
    | "currentBranch"
    | "runCommand"
    | "runCommandWithOutput"
    | "resolveCommandPath"
    | "gitGenerateCommitMessage"
    | "toCommitMessageArgs"
    | "pushBranch"
    | "buildManualPrUrl"
  >,
): Promise<GitCommitResult> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }

  const branch = await deps.currentBranch(repoRoot);
  if (request.includeUnstaged) {
    await deps.runCommand("git", ["-C", repoRoot, "add", "-A"], repoRoot);
  }

  const staged = await deps.runCommandWithOutput("git", ["-C", repoRoot, "diff", "--cached", "--name-only"], repoRoot).catch(() => "");
  if (staged.trim().length === 0) {
    throw new Error(request.includeUnstaged ? "No changes to commit." : "No staged changes to commit.");
  }

  const guidancePrompt =
    request.guidancePrompt && request.guidancePrompt.trim().length > 0
      ? request.guidancePrompt.trim()
      : DEFAULT_COMMIT_GUIDANCE;
  const shouldRequireGeneratedMessage = request.nextStep === "commit_and_create_pr" || Boolean(request.guidancePrompt?.trim());
  const message =
    request.message && request.message.trim().length > 0
      ? request.message.trim()
      : await deps.gitGenerateCommitMessage(directory, request.includeUnstaged, guidancePrompt, {
        requireGeneratedMessage: shouldRequireGeneratedMessage,
      });

  if (!message || message.trim().length === 0) {
    throw new Error("Commit message cannot be empty.");
  }

  let ghCommandPath: string | undefined;
  let ghUnavailableReason: string | undefined;
  if (request.nextStep === "commit_and_create_pr") {
    ghCommandPath = await deps.resolveCommandPath("gh", repoRoot);
    if (!ghCommandPath) {
      ghUnavailableReason = "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
    }
    if (ghCommandPath) {
      try {
        await deps.runCommandWithOutput(ghCommandPath, ["auth", "status"], repoRoot);
      } catch (error) {
        if (isMissingGhCliError(error)) {
          ghUnavailableReason = "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
        } else if (isGhAuthError(error)) {
          ghUnavailableReason = "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
        } else {
          throw new Error(`Unable to verify GitHub CLI auth: ${sanitizeError(error)}`);
        }
      }
    }
  }

  const commitArgs = ["-C", repoRoot, "commit", ...deps.toCommitMessageArgs(message.trim())];
  await deps.runCommand("git", commitArgs, repoRoot);
  const commitHash = (await deps.runCommandWithOutput("git", ["-C", repoRoot, "rev-parse", "HEAD"], repoRoot)).trim();

  let pushed = false;
  let prUrl: string | undefined;

  if (request.nextStep === "commit_and_push" || request.nextStep === "commit_and_create_pr") {
    await deps.pushBranch(repoRoot, branch);
    pushed = true;
  }

  if (request.nextStep === "commit_and_create_pr") {
    const baseBranch = request.baseBranch?.trim();
    if (baseBranch && baseBranch === branch) {
      throw new Error("Base branch must be different from the current branch.");
    }
    if (baseBranch) {
      await deps.runCommand("git", ["-C", repoRoot, "check-ref-format", "--branch", baseBranch], repoRoot).catch(() => {
        throw new Error("Invalid PR base branch name.");
      });
    }

    if (ghUnavailableReason) {
      prUrl = await deps.buildManualPrUrl(repoRoot, branch, baseBranch);
    } else {
      const prArgs = ["pr", "create", "--fill", "--head", branch];
      if (baseBranch) {
        prArgs.push("--base", baseBranch);
      }
      let output: string;
      try {
        output = await deps.runCommandWithOutput(ghCommandPath ?? "gh", prArgs, repoRoot);
      } catch (error) {
        const detail = sanitizeError(error);
        if (isMissingGhCliError(error) || isGhAuthError(error)) {
          prUrl = await deps.buildManualPrUrl(repoRoot, branch, baseBranch);
          if (prUrl) {
            output = prUrl;
          } else {
            throw new Error(`Unable to create PR: ${detail}`);
          }
        } else {
          const normalized = detail.toLowerCase();
          const canRetryWithoutFill =
            normalized.includes("could not compute title or body defaults") ||
            normalized.includes("unknown revision or path not in the working tree") ||
            normalized.includes("ambiguous argument");
          if (!canRetryWithoutFill) {
            throw new Error(`Unable to create PR: ${detail}`);
          }

          const [titleLine, ...bodyLines] = message.trim().split(/\r?\n/);
          const fallbackTitle = titleLine.trim().length > 0 ? titleLine.trim() : `chore: open PR from ${branch}`;
          const fallbackBody = bodyLines.join("\n").trim() || `Automated PR created from ${branch}.`;
          const fallbackArgs = ["pr", "create", "--title", fallbackTitle, "--body", fallbackBody, "--head", branch];
          if (baseBranch) {
            fallbackArgs.push("--base", baseBranch);
          }
          output = await deps.runCommandWithOutput(ghCommandPath ?? "gh", fallbackArgs, repoRoot).catch(async (fallbackError) => {
            const fallbackDetail = sanitizeError(fallbackError);
            if (isMissingGhCliError(fallbackError) || isGhAuthError(fallbackError)) {
              const fallbackUrl = await deps.buildManualPrUrl(repoRoot, branch, baseBranch);
              if (fallbackUrl) {
                return fallbackUrl;
              }
            }
            throw new Error(`Unable to create PR: ${fallbackDetail}`);
          });
        }
      }
      const urlMatch = output.match(/https?:\/\/[^\s]+/i);
      prUrl = urlMatch ? urlMatch[0] : prUrl;
    }
    if (!prUrl) {
      if (ghUnavailableReason) {
        throw new Error(ghUnavailableReason);
      }
      throw new Error("Unable to determine pull request URL.");
    }
  }

  return {
    repoRoot,
    branch,
    commitHash,
    message: message.trim(),
    pushed,
    prUrl,
  };
}

export async function gitBranchesWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommandWithOutput" | "currentBranch">): Promise<GitBranchState> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }

  const current = await deps.currentBranch(repoRoot);
  const localOutput = await deps.runCommandWithOutput(
    "git",
    ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
    repoRoot,
  ).catch(() => "");
  const remoteOutput = await deps.runCommandWithOutput(
    "git",
    ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    repoRoot,
  ).catch(() => "");
  const localBranches = localOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
  const remoteBranches = remoteOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line !== "origin")
    .filter((line) => !line.endsWith("/HEAD"))
    .map((line) => line.replace(/^origin\//, ""));
  const branches = [...new Set([...localBranches, ...remoteBranches])].sort((left, right) => left.localeCompare(right));
  if (!branches.includes(current)) {
    branches.unshift(current);
  }

  return {
    repoRoot,
    current,
    branches,
  };
}

export async function gitCheckoutBranchWorkflow(directory: string, branch: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand" | "gitRefExists" | "gitBranches">): Promise<GitBranchState> {
  const nextBranch = branch.trim();
  if (!nextBranch) {
    throw new Error("Branch name is required.");
  }

  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }

  await deps.runCommand("git", ["-C", repoRoot, "check-ref-format", "--branch", nextBranch], repoRoot).catch(() => {
    throw new Error("Invalid branch name.");
  });

  const hasLocal = await deps.gitRefExists(repoRoot, `refs/heads/${nextBranch}`);
  if (hasLocal) {
    await deps.runCommand("git", ["-C", repoRoot, "checkout", nextBranch], repoRoot);
  } else {
    const hasRemote = await deps.gitRefExists(repoRoot, `refs/remotes/origin/${nextBranch}`);
    if (hasRemote) {
      try {
        await deps.runCommand("git", ["-C", repoRoot, "checkout", "-b", nextBranch, "--track", `origin/${nextBranch}`], repoRoot);
      } catch (error) {
        const message = sanitizeError(error).toLowerCase();
        if (!message.includes("already exists")) {
          throw error;
        }
        await deps.runCommand("git", ["-C", repoRoot, "checkout", nextBranch], repoRoot);
      }
    } else {
      try {
        await deps.runCommand("git", ["-C", repoRoot, "checkout", "-b", nextBranch], repoRoot);
      } catch (error) {
        const message = sanitizeError(error).toLowerCase();
        if (!message.includes("already exists")) {
          throw error;
        }
        await deps.runCommand("git", ["-C", repoRoot, "checkout", nextBranch], repoRoot);
      }
    }
  }

  return deps.gitBranches(repoRoot);
}

export async function gitStageAllWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand">): Promise<boolean> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  await deps.runCommand("git", ["-C", repoRoot, "add", "-A", "--", "."], repoRoot);
  return true;
}

export async function gitRestoreAllUnstagedWorkflow(directory: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand">): Promise<boolean> {
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  await deps.runCommand("git", ["-C", repoRoot, "restore", "--worktree", "--", "."], repoRoot);
  return true;
}

export async function gitStagePathWorkflow(directory: string, filePath: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand">): Promise<boolean> {
  const targetPath = filePath.trim();
  if (!targetPath) {
    throw new Error("File path is required.");
  }
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  await deps.runCommand("git", ["-C", repoRoot, "add", "--", targetPath], repoRoot);
  return true;
}

export async function gitRestorePathWorkflow(directory: string, filePath: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand">): Promise<boolean> {
  const targetPath = filePath.trim();
  if (!targetPath) {
    throw new Error("File path is required.");
  }
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  await deps.runCommand("git", ["-C", repoRoot, "restore", "--worktree", "--", targetPath], repoRoot);
  return true;
}

export async function gitUnstagePathWorkflow(directory: string, filePath: string, deps: Pick<BasicDeps, "resolveGitRepoRoot" | "runCommand">): Promise<boolean> {
  const targetPath = filePath.trim();
  if (!targetPath) {
    throw new Error("File path is required.");
  }
  const cwd = path.resolve(directory);
  const repoRoot = await deps.resolveGitRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error("Not a git repository.");
  }
  await deps.runCommand("git", ["-C", repoRoot, "restore", "--staged", "--", targetPath], repoRoot);
  return true;
}
