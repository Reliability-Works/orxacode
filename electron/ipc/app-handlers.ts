import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc";
import type { SkillEntry } from "../../shared/ipc";
import { assertExternalUrl, assertString } from "./validators";

type AppHandlersDeps = {
  getMainWindow: () => BrowserWindow | null;
};

export function registerAppHandlers({ getMainWindow }: AppHandlersDeps) {
  ipcMain.handle(IPC.appOpenExternal, async (_event, url: unknown) => {
    await shell.openExternal(assertExternalUrl(url));
    return true;
  });

  ipcMain.handle(IPC.appOpenFile, async (_event, options?: unknown) => {
    const opts: Electron.OpenDialogOptions = { properties: ["openFile"] };
    if (options && typeof options === "object") {
      const input = options as { title?: unknown; filters?: unknown };
      if (typeof input.title === "string") opts.title = input.title;
      if (Array.isArray(input.filters)) {
        opts.filters = input.filters.filter(
          (f: unknown): f is { name: string; extensions: string[] } =>
            !!f && typeof f === "object" && typeof (f as Record<string, unknown>).name === "string" && Array.isArray((f as Record<string, unknown>).extensions),
        );
      }
    }
    const mainWindow = getMainWindow();
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return undefined;
    const filePath = result.filePaths[0]!;
    return {
      path: filePath,
      filename: path.basename(filePath),
      url: pathToFileURL(filePath).toString(),
    };
  });

  ipcMain.handle(IPC.appReadTextFile, async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") throw new Error("filePath must be a string");
    const homeDir = app.getPath("home");
    const resolved = path.resolve(filePath.replace(/^~/, homeDir));
    const allowedPrefixes = [
      path.join(homeDir, ".claude"),
      path.join(homeDir, ".codex"),
    ];
    const isAllowed = allowedPrefixes.some((prefix) => resolved.startsWith(prefix + path.sep) || resolved === prefix);
    if (!isAllowed) throw new Error("Reading files outside ~/.claude/ and ~/.codex/ is not allowed");
    const basename = path.basename(resolved);
    if (basename === "auth.json" || basename === "credentials.json") {
      throw new Error(`Reading ${basename} is not allowed for security reasons`);
    }
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(resolved, "utf-8");
      return content;
    } catch {
      return "";
    }
  });

  ipcMain.handle(IPC.appWriteTextFile, async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== "string") throw new Error("filePath must be a string");
    if (typeof content !== "string") throw new Error("content must be a string");
    const homeDir = app.getPath("home");
    const resolved = path.resolve(filePath.replace(/^~/, homeDir));
    const allowedPrefixes = [
      path.join(homeDir, ".claude"),
      path.join(homeDir, ".codex"),
    ];
    const isAllowed = allowedPrefixes.some((prefix) => resolved.startsWith(prefix + path.sep) || resolved === prefix);
    if (!isAllowed) throw new Error("Writing files outside ~/.claude/ and ~/.codex/ is not allowed");
    const basename = path.basename(resolved);
    if (basename === "auth.json" || basename === "credentials.json") {
      throw new Error(`Writing ${basename} is not allowed for security reasons`);
    }
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    return true;
  });

  ipcMain.handle(IPC.appRevealInFinder, async (_event, dirPath: unknown) => {
    if (typeof dirPath !== "string") throw new Error("dirPath must be a string");
    const homeDir = app.getPath("home");
    const resolved = path.resolve(dirPath.replace(/^~/, homeDir));
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle(IPC.appScanPorts, async (_event, directory?: unknown) => {
    const { exec } = await import("node:child_process");
    const dir = typeof directory === "string" ? directory : undefined;
    return new Promise((resolve) => {
      exec("lsof -iTCP -sTCP:LISTEN -nP -Fn -Fp -Fc", { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        const entries: Array<{ port: number; pid: number; process: string; command: string }> = [];
        let currentPid = 0;
        let currentProcess = "";
        let currentCommand = "";
        for (const line of stdout.split("\n")) {
          if (!line) continue;
          const prefix = line[0];
          const value = line.slice(1);
          if (prefix === "p") {
            currentPid = parseInt(value, 10);
          } else if (prefix === "c") {
            currentCommand = value;
          } else if (prefix === "n") {
            currentProcess = currentCommand;
            const portMatch = value.match(/:(\d+)$/);
            if (portMatch) {
              const port = parseInt(portMatch[1]!, 10);
              if (!isNaN(port) && port > 0) {
                entries.push({ port, pid: currentPid, process: currentProcess, command: currentCommand });
              }
            }
          }
        }
        const seen = new Set<number>();
        const unique = entries.filter((e) => {
          if (seen.has(e.port)) return false;
          seen.add(e.port);
          return true;
        });
        // Note: TCP port scanning is system-wide; there's no reliable way to scope
        // listening ports to a specific workspace directory at the OS level.
        void dir;
        resolve(unique);
      });
    });
  });

  ipcMain.handle(IPC.appHttpRequest, async (_event, options: unknown) => {
    if (!options || typeof options !== "object") throw new Error("options is required");
    const input = options as { method?: unknown; url?: unknown; headers?: unknown; body?: unknown };
    const method = assertString(input.method, "method");
    const url = assertString(input.url, "url");
    const headers: Record<string, string> = {};
    if (input.headers && typeof input.headers === "object") {
      for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    const bodyStr = typeof input.body === "string" ? input.body : undefined;

    const start = Date.now();
    const init: RequestInit = { method, headers };
    if (bodyStr && method !== "GET" && method !== "HEAD") {
      init.body = bodyStr;
    }
    try {
      const response = await fetch(url, init);
      const elapsed = Date.now() - start;
      const text = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });
      return { status: response.status, headers: responseHeaders, body: text, elapsed };
    } catch (err) {
      const elapsed = Date.now() - start;
      return { status: 0, headers: {}, body: err instanceof Error ? err.message : String(err), elapsed };
    }
  });

  ipcMain.handle(IPC.appListSkillsFromDir, async (_event, directory: unknown) => {
    const raw = assertString(directory, "directory");
    const home = homedir();
    const root = raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw;
    // Restrict to known skill directories under home
    const allowedPrefixes = [
      path.join(home, ".config", "opencode", "skill"),
      path.join(home, ".codex", "skills"),
      path.join(home, ".claude", "skills"),
    ];
    const resolved = path.resolve(root);
    if (!allowedPrefixes.some((p) => resolved === p || resolved.startsWith(p + path.sep))) {
      throw new Error("Reading skills outside allowed directories is not permitted");
    }
    const rootInfo = await stat(root).catch(() => undefined);
    if (!rootInfo?.isDirectory()) {
      return [] as SkillEntry[];
    }
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const skills: SkillEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name);
      const filePath = path.join(skillPath, "SKILL.md");
      const file = await readFile(filePath, "utf8").catch(() => "");
      if (!file) continue;
      const rawLines = file.split(/\r?\n/).map((line) => line.trim());
      // Skip YAML frontmatter (lines between opening and closing ---)
      let lines = rawLines;
      if (rawLines[0] === "---") {
        const closeIdx = rawLines.indexOf("---", 1);
        if (closeIdx > 0) {
          lines = rawLines.slice(closeIdx + 1);
        }
      }
      const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || entry.name;
      const description =
        lines.find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("```") && line !== "---") || "No description available.";
      skills.push({ id: entry.name, name: title, description, path: skillPath });
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  });

  ipcMain.handle(IPC.appRunAgentCli, async (_event, options: unknown) => {
    if (!options || typeof options !== "object") throw new Error("options is required");
    const { agent, prompt, cwd } = options as { agent?: string; prompt?: string; cwd?: string };
    if (!agent || !prompt || !cwd) throw new Error("agent, prompt, and cwd are required");

    const AGENT_COMMANDS: Record<string, { bin: string; args: (p: string) => string[] }> = {
      opencode: { bin: "opencode", args: (p) => ["run", p] },
      codex: { bin: "codex", args: (p) => ["exec", p] },
      claude: { bin: "claude", args: (p) => ["-p", p] },
    };

    const config = AGENT_COMMANDS[agent];
    if (!config) throw new Error(`Unknown agent: ${agent}`);

    return new Promise<{ ok: boolean; output: string; exitCode: number }>((resolve) => {
      const child = execFile(config.bin, config.args(prompt), {
        cwd,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        const output = (stdout || "") + (stderr ? `\n${stderr}` : "");
        const exitCode = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? 1 : (child.exitCode ?? (error ? 1 : 0));
        resolve({ ok: exitCode === 0, output, exitCode });
      });
    });
  });
}
