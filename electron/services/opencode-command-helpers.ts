import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEPENDENCY_CHECK_TIMEOUT_MS, sanitizeError } from "./opencode-runtime-helpers";

export type OpenCommandAttempt = {
  command: string;
  args: string[];
  label: string;
};

export class OpencodeCommandHelpers {
  async runCommand(command: string, args: string[], cwd: string) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr?.on("data", (chunk) => {
        stderr.push(String(chunk));
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const tail = [...stdout, ...stderr].join("").trim().slice(-2000);
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${tail ? `: ${tail}` : ""}`));
      });
    });
  }

  async runCommandWithOutput(command: string, args: string[], cwd: string) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr?.on("data", (chunk) => {
        stderr.push(String(chunk));
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.join(""));
          return;
        }
        const details = `${stdout.join("")}\n${stderr.join("")}`.trim().slice(-2000);
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${details ? `: ${details}` : ""}`));
      });
    });
  }

  async canRunCommand(command: string, args: string[], cwd: string) {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: "ignore",
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, DEPENDENCY_CHECK_TIMEOUT_MS);

      child.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    });
  }

  async commandPathCandidates(command: string) {
    const base = [
      path.join("/opt/homebrew/bin", command),
      path.join("/usr/local/bin", command),
      path.join(homedir(), ".volta", "bin", command),
      path.join(homedir(), ".asdf", "shims", command),
      path.join(homedir(), ".local", "share", "mise", "shims", command),
      path.join(homedir(), ".fnm", "current", "bin", command),
    ];

    const nvmDir = path.join(homedir(), ".nvm", "versions", "node");
    const nvmEntries = await readdir(nvmDir, { withFileTypes: true }).catch(() => []);
    for (const entry of nvmEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      base.push(path.join(nvmDir, entry.name, "bin", command));
    }

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const candidate of base) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      if (existsSync(candidate)) {
        unique.push(candidate);
      }
    }
    return unique;
  }

  async canRunCommandViaLoginShell(command: string, args: string[], cwd: string) {
    const shell = process.env.SHELL || "/bin/zsh";
    const quotedCommand = this.shellQuote(command);
    const quotedArgs = args.map((item) => this.shellQuote(item)).join(" ");
    const probe = `cmd_path="$(command -v ${quotedCommand})" || exit 127; "$cmd_path" ${quotedArgs} >/dev/null 2>&1`;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const child = spawn(shell, ["-ilc", probe], {
        cwd,
        env: process.env,
        stdio: "ignore",
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, DEPENDENCY_CHECK_TIMEOUT_MS);

      child.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
    });
  }

  async canRunCommandWithFallbacks(command: string, args: string[], cwd: string) {
    const direct = await this.canRunCommand(command, args, cwd);
    if (direct) {
      return true;
    }
    const candidates = await this.commandPathCandidates(command);
    for (const candidate of candidates) {
      if (await this.canRunCommand(candidate, args, cwd)) {
        return true;
      }
    }
    return this.canRunCommandViaLoginShell(command, args, cwd);
  }

  async commandPathViaLoginShell(command: string, cwd: string) {
    const shell = process.env.SHELL || "/bin/zsh";
    const quotedCommand = this.shellQuote(command);
    const probe = `command -v ${quotedCommand} || exit 127`;

    return new Promise<string | undefined>((resolve) => {
      let settled = false;
      const finish = (value: string | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const child = spawn(shell, ["-ilc", probe], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const stdout: string[] = [];
      child.stdout?.on("data", (chunk) => {
        stdout.push(String(chunk));
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(undefined);
      }, DEPENDENCY_CHECK_TIMEOUT_MS);

      child.on("error", () => {
        clearTimeout(timer);
        finish(undefined);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          finish(undefined);
          return;
        }
        const resolved = stdout.join("").trim();
        finish(resolved.length > 0 ? resolved : undefined);
      });
    });
  }

  async resolveCommandPath(command: string, cwd: string) {
    if (await this.canRunCommand(command, ["--version"], cwd)) {
      return command;
    }

    const candidates = await this.commandPathCandidates(command);
    for (const candidate of candidates) {
      if (await this.canRunCommand(candidate, ["--version"], cwd)) {
        return candidate;
      }
    }

    return this.commandPathViaLoginShell(command, cwd);
  }

  shellQuote(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  async runCommandAttempts(
    attempts: OpenCommandAttempt[],
    cwd: string,
    runCommand: (command: string, args: string[], attemptCwd: string) => Promise<void>,
  ) {
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await runCommand(attempt.command, attempt.args, cwd);
        return `Opened in ${attempt.label}`;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(sanitizeError(lastError ?? "Unable to open directory"));
  }
}
