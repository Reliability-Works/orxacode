import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import {
  type ArtifactExportBundleInput,
  type ArtifactListQuery,
  type ArtifactRetentionUpdateInput,
  type BrowserAgentActionRequest,
  type BrowserBounds,
  type BrowserLocator,
  IPC,
  type AppMode,
  type GitCommitRequest,
  type MemoryGraphQuery,
  type MemorySettingsUpdateInput,
  type OpenDirectoryTarget,
  type OrxaEvent,
  type WorkspaceContextWriteInput,
  type UpdatePreferences,
  type RuntimeProfileInput,
} from "../shared/ipc";
import { OpencodeService } from "./services/opencode-service";
import { BrowserController } from "./services/browser-controller";
import { shouldRunOrxaBootstrap } from "./services/app-mode";
import { ModeStore } from "./services/mode-store";
import { setupAutoUpdates, type AutoUpdaterController } from "./services/auto-updater";
import { createStartupBootstrapTracker } from "./services/startup-bootstrap";
import { resolveRendererHtmlPath } from "./services/renderer-entry";

// Enable CDP remote debugging on a random available port so that
// chrome-devtools-mcp can connect to our Electron browser views.
app.commandLine.appendSwitch("remote-debugging-port", "0");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const service = new OpencodeService();
const modeStore = new ModeStore();
let mainWindow: BrowserWindow | null = null;
let browserController: BrowserController | null = null;
let autoUpdaterController: AutoUpdaterController | undefined;
let resolvedCdpPort: number | null = null;
const startupBootstrap = createStartupBootstrapTracker();
const PTY_OUTPUT_FLUSH_MS = 16;
const SMOKE_TEST_FLAG = "--smoke-test";
const ptyOutputBuffer = new Map<string, { directory: string; ptyID: string; chunks: string[] }>();
const ptyOutputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function assertExternalUrl(value: unknown): string {
  const raw = assertString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid external URL");
  }
  if (!["https:", "http:", "mailto:", "file:"].includes(parsed.protocol)) {
    throw new Error("Unsupported external URL scheme");
  }
  return parsed.toString();
}

function assertOpenDirectoryTarget(value: unknown): OpenDirectoryTarget {
  const allowed: OpenDirectoryTarget[] = ["cursor", "antigravity", "finder", "terminal", "ghostty", "xcode", "zed"];
  if (typeof value !== "string" || !allowed.includes(value as OpenDirectoryTarget)) {
    throw new Error("Invalid open target");
  }
  return value as OpenDirectoryTarget;
}

function assertAppMode(value: unknown): AppMode {
  if (value !== "orxa" && value !== "standard") {
    throw new Error("Invalid app mode");
  }
  return value;
}

function assertUpdatePreferencesInput(input: unknown): Partial<UpdatePreferences> {
  if (!input || typeof input !== "object") {
    throw new Error("Update preferences input is required");
  }

  const payload = input as Partial<UpdatePreferences>;
  const result: Partial<UpdatePreferences> = {};

  if (payload.autoCheckEnabled !== undefined) {
    if (typeof payload.autoCheckEnabled !== "boolean") {
      throw new Error("autoCheckEnabled must be a boolean");
    }
    result.autoCheckEnabled = payload.autoCheckEnabled;
  }

  if (payload.releaseChannel !== undefined) {
    if (payload.releaseChannel !== "stable" && payload.releaseChannel !== "prerelease") {
      throw new Error("Invalid release channel");
    }
    result.releaseChannel = payload.releaseChannel;
  }

  return result;
}

function assertPort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string, maxItems = 32): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${field} exceeds maximum item count (${maxItems})`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${field}[${index}] must be a non-empty string`);
    }
    if (item.length > 2048) {
      throw new Error(`${field}[${index}] is too long`);
    }
    return item;
  });
}

function assertRuntimeProfileInput(value: unknown): RuntimeProfileInput {
  if (!value || typeof value !== "object") {
    throw new Error("Runtime profile payload is required");
  }
  const payload = value as Partial<RuntimeProfileInput>;
  return {
    id: typeof payload.id === "string" ? payload.id : undefined,
    name: assertString(payload.name, "name"),
    host: assertString(payload.host, "host"),
    port: assertPort(payload.port, "port"),
    https: assertBoolean(payload.https, "https"),
    username: typeof payload.username === "string" ? payload.username : undefined,
    password: typeof payload.password === "string" ? payload.password : undefined,
    startCommand: assertBoolean(payload.startCommand, "startCommand"),
    startHost: assertString(payload.startHost, "startHost"),
    startPort: assertPort(payload.startPort, "startPort"),
    cliPath: typeof payload.cliPath === "string" ? payload.cliPath : undefined,
    corsOrigins: assertStringArray(payload.corsOrigins, "corsOrigins", 64),
  };
}

function assertSafeJsonValue(value: unknown, field: string, depth = 0): unknown {
  if (depth > 24) {
    throw new Error(`${field} exceeds max nesting depth`);
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_500) {
      throw new Error(`${field} exceeds max array length`);
    }
    return value.map((item, index) => assertSafeJsonValue(item, `${field}[${index}]`, depth + 1));
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error(`${field} must be a plain object`);
    }
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error(`${field} contains restricted key ${key}`);
      }
      next[key] = assertSafeJsonValue(nested, `${field}.${key}`, depth + 1);
    }
    return next;
  }
  throw new Error(`${field} contains unsupported value type`);
}

function assertConfigPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config patch must be an object");
  }
  return assertSafeJsonValue(value, "patch") as Parameters<typeof service.updateConfig>[1];
}

function assertPromptRequestInput(value: unknown): Parameters<typeof service.sendPrompt>[0] {
  if (!value || typeof value !== "object") {
    throw new Error("Prompt request is required");
  }

  const payload = value as {
    directory?: unknown;
    sessionID?: unknown;
    text?: unknown;
    attachments?: unknown;
    agent?: unknown;
    model?: unknown;
    variant?: unknown;
    system?: unknown;
    contextModeEnabled?: unknown;
    promptSource?: unknown;
    tools?: unknown;
  };

  const text = assertString(payload.text, "text");
  if (text.length > 64_000) {
    throw new Error("text exceeds maximum length");
  }

  const result: Parameters<typeof service.sendPrompt>[0] = {
    directory: assertString(payload.directory, "directory"),
    sessionID: assertString(payload.sessionID, "sessionID"),
    text,
  };

  if (payload.attachments !== undefined) {
    if (!Array.isArray(payload.attachments) || payload.attachments.length > 24) {
      throw new Error("attachments must be an array with at most 24 items");
    }
    result.attachments = payload.attachments.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`attachments[${index}] must be an object`);
      }
      const item = entry as { url?: unknown; mime?: unknown; filename?: unknown };
      const url = assertString(item.url, `attachments[${index}].url`);
      const mime = assertString(item.mime, `attachments[${index}].mime`);
      if (url.length > 4096) {
        throw new Error(`attachments[${index}].url is too long`);
      }
      if (mime.length > 256) {
        throw new Error(`attachments[${index}].mime is too long`);
      }
      const attachment: { url: string; mime: string; filename?: string } = { url, mime };
      if (item.filename !== undefined) {
        if (typeof item.filename !== "string" || item.filename.length > 256) {
          throw new Error(`attachments[${index}].filename must be a string (max 256 chars)`);
        }
        attachment.filename = item.filename;
      }
      return attachment;
    });
  }

  if (payload.agent !== undefined) {
    if (typeof payload.agent !== "string" || payload.agent.length > 128) {
      throw new Error("agent must be a string with max length 128");
    }
    result.agent = payload.agent;
  }

  if (payload.model !== undefined) {
    if (!payload.model || typeof payload.model !== "object") {
      throw new Error("model must be an object");
    }
    const model = payload.model as { providerID?: unknown; modelID?: unknown };
    result.model = {
      providerID: assertString(model.providerID, "model.providerID"),
      modelID: assertString(model.modelID, "model.modelID"),
    };
  }

  if (payload.variant !== undefined) {
    if (typeof payload.variant !== "string" || payload.variant.length > 128) {
      throw new Error("variant must be a string with max length 128");
    }
    result.variant = payload.variant;
  }

  if (payload.system !== undefined) {
    if (typeof payload.system !== "string" || payload.system.length > 32_000) {
      throw new Error("system must be a string with max length 32000");
    }
    result.system = payload.system;
  }

  if (payload.contextModeEnabled !== undefined) {
    result.contextModeEnabled = assertBoolean(payload.contextModeEnabled, "contextModeEnabled");
  }

  if (payload.promptSource !== undefined) {
    if (payload.promptSource !== "user" && payload.promptSource !== "job" && payload.promptSource !== "machine") {
      throw new Error("promptSource must be 'user', 'job', or 'machine'");
    }
    result.promptSource = payload.promptSource;
  }

  if (payload.tools !== undefined) {
    if (!payload.tools || typeof payload.tools !== "object" || Array.isArray(payload.tools)) {
      throw new Error("tools must be an object map of tool name to boolean");
    }
    const toolsEntries = Object.entries(payload.tools as Record<string, unknown>);
    if (toolsEntries.length > 256) {
      throw new Error("tools cannot include more than 256 entries");
    }
    const tools: Record<string, boolean> = {};
    for (const [toolName, enabled] of toolsEntries) {
      if (toolName.length === 0 || toolName.length > 128) {
        throw new Error("tools keys must be non-empty strings with max length 128");
      }
      if (enabled !== true && enabled !== false) {
        throw new Error(`tools.${toolName} must be a boolean`);
      }
      tools[toolName] = enabled;
    }
    result.tools = tools;
  }

  return result;
}

function assertMemoryPolicyPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory policy patch must be an object");
  }
  const payload = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      throw new Error("memory policy enabled must be a boolean");
    }
    out.enabled = payload.enabled;
  }
  if (payload.mode !== undefined) {
    if (typeof payload.mode !== "string") {
      throw new Error("memory policy mode must be a string");
    }
    out.mode = payload.mode;
  }
  if (payload.guidance !== undefined) {
    if (typeof payload.guidance !== "string" || payload.guidance.length > 4_000) {
      throw new Error("memory policy guidance must be a string (max 4000 chars)");
    }
    out.guidance = payload.guidance;
  }
  if (payload.maxPromptMemories !== undefined) {
    if (typeof payload.maxPromptMemories !== "number" || !Number.isFinite(payload.maxPromptMemories)) {
      throw new Error("memory policy maxPromptMemories must be a number");
    }
    out.maxPromptMemories = payload.maxPromptMemories;
  }
  if (payload.maxCapturePerSession !== undefined) {
    if (typeof payload.maxCapturePerSession !== "number" || !Number.isFinite(payload.maxCapturePerSession)) {
      throw new Error("memory policy maxCapturePerSession must be a number");
    }
    out.maxCapturePerSession = payload.maxCapturePerSession;
  }
  return out;
}

function assertMemorySettingsUpdateInput(value: unknown): MemorySettingsUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory settings update payload is required");
  }
  const payload = value as Record<string, unknown>;
  const output: MemorySettingsUpdateInput = {};
  if (payload.directory !== undefined) {
    output.directory = assertString(payload.directory, "directory");
  }
  if (payload.global !== undefined) {
    output.global = assertMemoryPolicyPatch(payload.global) as MemorySettingsUpdateInput["global"];
  }
  if (payload.workspace !== undefined) {
    output.workspace = assertMemoryPolicyPatch(payload.workspace) as MemorySettingsUpdateInput["workspace"];
  }
  if (payload.clearWorkspaceOverride !== undefined) {
    output.clearWorkspaceOverride = assertBoolean(payload.clearWorkspaceOverride, "clearWorkspaceOverride");
  }
  return output;
}

function assertMemoryGraphQuery(value: unknown): MemoryGraphQuery {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory graph query must be an object");
  }
  const payload = value as Record<string, unknown>;
  const output: MemoryGraphQuery = {};
  if (payload.workspace !== undefined) {
    output.workspace = assertString(payload.workspace, "workspace");
  }
  if (payload.query !== undefined) {
    if (typeof payload.query !== "string" || payload.query.length > 512) {
      throw new Error("query must be a string with max length 512");
    }
    output.query = payload.query;
  }
  if (payload.relation !== undefined) {
    if (typeof payload.relation !== "string" || payload.relation.length > 64) {
      throw new Error("relation must be a string with max length 64");
    }
    output.relation = payload.relation;
  }
  if (payload.limit !== undefined) {
    if (typeof payload.limit !== "number" || !Number.isFinite(payload.limit)) {
      throw new Error("limit must be a number");
    }
    output.limit = payload.limit;
  }
  return output;
}

function assertArtifactListQuery(value: unknown): ArtifactListQuery {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact list query must be an object");
  }
  const payload = value as Record<string, unknown>;
  const output: ArtifactListQuery = {};
  if (payload.workspace !== undefined) {
    output.workspace = assertString(payload.workspace, "workspace");
  }
  if (payload.sessionID !== undefined) {
    output.sessionID = assertString(payload.sessionID, "sessionID");
  }
  if (payload.kind !== undefined) {
    if (typeof payload.kind === "string") {
      output.kind = payload.kind as ArtifactListQuery["kind"];
    } else if (Array.isArray(payload.kind)) {
      output.kind = payload.kind.filter((item): item is string => typeof item === "string") as ArtifactListQuery["kind"];
    } else {
      throw new Error("kind must be a string or string[]");
    }
  }
  if (payload.limit !== undefined) {
    output.limit = Math.floor(assertFiniteNumber(payload.limit, "limit"));
  }
  return output;
}

function assertArtifactRetentionUpdateInput(value: unknown): ArtifactRetentionUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact retention payload is required");
  }
  const payload = value as Record<string, unknown>;
  const maxBytes = Math.floor(assertFiniteNumber(payload.maxBytes, "maxBytes"));
  if (maxBytes < 1) {
    throw new Error("maxBytes must be greater than 0");
  }
  return { maxBytes };
}

function assertArtifactExportBundleInput(value: unknown): ArtifactExportBundleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact export payload is required");
  }
  const payload = value as Record<string, unknown>;
  const output: ArtifactExportBundleInput = {
    workspace: assertString(payload.workspace, "workspace"),
  };
  if (payload.sessionID !== undefined) {
    output.sessionID = assertString(payload.sessionID, "sessionID");
  }
  if (payload.kind !== undefined) {
    if (typeof payload.kind === "string") {
      output.kind = payload.kind as ArtifactExportBundleInput["kind"];
    } else if (Array.isArray(payload.kind)) {
      output.kind = payload.kind.filter((item): item is string => typeof item === "string") as ArtifactExportBundleInput["kind"];
    } else {
      throw new Error("kind must be a string or string[]");
    }
  }
  if (payload.limit !== undefined) {
    output.limit = Math.floor(assertFiniteNumber(payload.limit, "limit"));
  }
  return output;
}

function assertWorkspaceContextWriteInput(value: unknown): WorkspaceContextWriteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace context write payload is required");
  }
  const payload = value as Record<string, unknown>;
  return {
    workspace: assertString(payload.workspace, "workspace"),
    id: payload.id === undefined ? undefined : assertString(payload.id, "id"),
    filename: payload.filename === undefined ? undefined : assertString(payload.filename, "filename"),
    title: payload.title === undefined ? undefined : assertString(payload.title, "title"),
    content: assertString(payload.content, "content"),
  };
}

function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return assertString(value, field);
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function assertBrowserBoundsInput(value: unknown): BrowserBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser bounds payload is required");
  }
  const payload = value as Partial<BrowserBounds>;
  const width = assertFiniteNumber(payload.width, "bounds.width");
  const height = assertFiniteNumber(payload.height, "bounds.height");
  return {
    x: assertFiniteNumber(payload.x, "bounds.x"),
    y: assertFiniteNumber(payload.y, "bounds.y"),
    width,
    height,
  };
}

function assertOptionalBrowserBoundsInput(value: unknown): Partial<BrowserBounds> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bounds must be an object");
  }
  const payload = value as Partial<BrowserBounds>;
  const output: Partial<BrowserBounds> = {};
  if (payload.x !== undefined) {
    output.x = assertFiniteNumber(payload.x, "bounds.x");
  }
  if (payload.y !== undefined) {
    output.y = assertFiniteNumber(payload.y, "bounds.y");
  }
  if (payload.width !== undefined) {
    output.width = assertFiniteNumber(payload.width, "bounds.width");
  }
  if (payload.height !== undefined) {
    output.height = assertFiniteNumber(payload.height, "bounds.height");
  }
  return output;
}

function assertOptionalBrowserLocatorInput(value: unknown): BrowserLocator | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("locator must be an object");
  }
  const payload = value as Record<string, unknown>;
  const locator: BrowserLocator = {};
  if (payload.selector !== undefined) {
    locator.selector = assertString(payload.selector, "locator.selector");
  }
  if (payload.selectors !== undefined) {
    locator.selectors = assertStringArray(payload.selectors, "locator.selectors", 24);
  }
  if (payload.text !== undefined) {
    locator.text = assertString(payload.text, "locator.text");
  }
  if (payload.role !== undefined) {
    locator.role = assertString(payload.role, "locator.role");
  }
  if (payload.name !== undefined) {
    locator.name = assertString(payload.name, "locator.name");
  }
  if (payload.label !== undefined) {
    locator.label = assertString(payload.label, "locator.label");
  }
  if (payload.frameSelector !== undefined) {
    locator.frameSelector = assertString(payload.frameSelector, "locator.frameSelector");
  }
  if (payload.includeShadowDom !== undefined) {
    locator.includeShadowDom = assertBoolean(payload.includeShadowDom, "locator.includeShadowDom");
  }
  if (payload.exact !== undefined) {
    locator.exact = assertBoolean(payload.exact, "locator.exact");
  }
  return locator;
}

function assertBrowserSender(event: IpcMainInvokeEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Main window is not available");
  }
  if (event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Unauthorized browser IPC sender");
  }
}

async function resolveCdpPort(): Promise<number> {
  if (resolvedCdpPort !== null) {
    return resolvedCdpPort;
  }
  // Discover the actual CDP port assigned by Electron.
  // When --remote-debugging-port=0 is used, Electron picks a random port.
  // We discover it via the webContents debugger or by probing known ports.
  try {
    const win = mainWindow;
    if (win) {
      const wc = win.webContents;
      wc.debugger.attach("1.3");
      const response = (await wc.debugger.sendCommand("Browser.getVersion")) as { webSocketDebuggerUrl?: string };
      wc.debugger.detach();
      if (response.webSocketDebuggerUrl) {
        const url = new URL(response.webSocketDebuggerUrl);
        const port = parseInt(url.port, 10);
        if (port > 0) {
          resolvedCdpPort = port;
          return port;
        }
      }
    }
  } catch {
    // debugger attach may fail, fall through
  }

  // Fallback: try a range of ports to find the CDP endpoint
  for (const port of [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230]) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        resolvedCdpPort = port;
        return port;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Could not resolve CDP debugging port. Ensure the app is running with remote debugging enabled.");
}

function requireBrowserController(): BrowserController {
  if (!browserController) {
    throw new Error("Browser controller is not initialized");
  }
  return browserController;
}

function assertBrowserAgentActionRequest(value: unknown): BrowserAgentActionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser action payload is required");
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.action !== "string") {
    throw new Error("Browser action is required");
  }

  const tabID = assertOptionalString(payload.tabID, "tabID");
  const timeoutMs = payload.timeoutMs === undefined ? undefined : Math.floor(assertFiniteNumber(payload.timeoutMs, "timeoutMs"));
  const maxAttempts = payload.maxAttempts === undefined ? undefined : Math.floor(assertFiniteNumber(payload.maxAttempts, "maxAttempts"));
  const locator = assertOptionalBrowserLocatorInput(payload.locator);
  const action = payload.action;
  switch (action) {
    case "open_tab":
      return {
        action,
        url: assertOptionalString(payload.url, "url"),
        activate: payload.activate === undefined ? undefined : assertBoolean(payload.activate, "activate"),
      };
    case "close_tab":
      return {
        action,
        tabID,
      };
    case "switch_tab":
      return {
        action,
        tabID: assertString(payload.tabID, "tabID"),
      };
    case "navigate":
      return {
        action,
        url: assertString(payload.url, "url"),
        tabID,
      };
    case "back":
    case "forward":
    case "reload":
      return {
        action,
        tabID,
      };
    case "click":
      return {
        action,
        tabID,
        selector: assertOptionalString(payload.selector, "selector"),
        locator,
        timeoutMs,
        maxAttempts,
        waitForNavigation:
          payload.waitForNavigation === undefined ? undefined : assertBoolean(payload.waitForNavigation, "waitForNavigation"),
      };
    case "type":
      return {
        action,
        text: assertString(payload.text, "text"),
        tabID,
        selector: assertOptionalString(payload.selector, "selector"),
        locator,
        submit: payload.submit === undefined ? undefined : assertBoolean(payload.submit, "submit"),
        clear: payload.clear === undefined ? undefined : assertBoolean(payload.clear, "clear"),
        timeoutMs,
        maxAttempts,
      };
    case "press":
      return {
        action,
        key: assertString(payload.key, "key"),
        tabID,
      };
    case "scroll": {
      const behavior =
        payload.behavior === undefined
          ? undefined
          : payload.behavior === "auto" || payload.behavior === "smooth"
            ? payload.behavior
            : (() => {
                throw new Error("scroll behavior must be 'auto' or 'smooth'");
              })();
      return {
        action,
        tabID,
        x: payload.x === undefined ? undefined : assertFiniteNumber(payload.x, "x"),
        y: payload.y === undefined ? undefined : assertFiniteNumber(payload.y, "y"),
        top: payload.top === undefined ? undefined : assertFiniteNumber(payload.top, "top"),
        left: payload.left === undefined ? undefined : assertFiniteNumber(payload.left, "left"),
        behavior,
      };
    }
    case "extract_text":
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        maxLength: payload.maxLength === undefined ? undefined : Math.floor(assertFiniteNumber(payload.maxLength, "maxLength")),
        locator,
        timeoutMs,
        maxAttempts,
      };
    case "exists":
    case "visible":
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        locator,
        timeoutMs,
      };
    case "wait_for": {
      const state =
        payload.state === undefined
          ? undefined
          : payload.state === "attached" || payload.state === "visible" || payload.state === "hidden"
            ? payload.state
            : (() => {
                throw new Error("wait_for state must be 'attached', 'visible', or 'hidden'");
              })();
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        locator,
        timeoutMs,
        state,
      };
    }
    case "wait_for_navigation":
      return {
        action,
        tabID,
        timeoutMs,
      };
    case "wait_for_idle":
      return {
        action,
        tabID,
        timeoutMs,
        idleMs: payload.idleMs === undefined ? undefined : Math.floor(assertFiniteNumber(payload.idleMs, "idleMs")),
      };
    case "screenshot": {
      const format =
        payload.format === undefined
          ? undefined
          : payload.format === "png" || payload.format === "jpeg"
            ? payload.format
            : (() => {
                throw new Error("screenshot format must be 'png' or 'jpeg'");
              })();
      return {
        action,
        tabID,
        format,
        quality: payload.quality === undefined ? undefined : assertFiniteNumber(payload.quality, "quality"),
        bounds: assertOptionalBrowserBoundsInput(payload.bounds),
        workspace: payload.workspace === undefined ? undefined : assertString(payload.workspace, "workspace"),
        sessionID: payload.sessionID === undefined ? undefined : assertString(payload.sessionID, "sessionID"),
        actionID: payload.actionID === undefined ? undefined : assertString(payload.actionID, "actionID"),
      };
    }
    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.mjs");

  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    // Match renderer base tone to avoid a blue flash before first paint.
    backgroundColor: "#121316",
    title: "",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Prevent renderer-triggered popups from auto-launching external browsers.
  // Explicit user-triggered opens are handled via validated IPC.
  window.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    const htmlPath = resolveRendererHtmlPath(__dirname);
    void window.loadFile(htmlPath);
  }

  return window;
}

function attachMainWindow(window: BrowserWindow) {
  mainWindow = window;
  browserController?.setWindow(window);
  window.on("closed", () => {
    if (mainWindow === window) {
      browserController?.setWindow(null);
      mainWindow = null;
    }
  });
  return window;
}

function buildAppMenuTemplate(): MenuItemConstructorOptions[] {
  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: "Check for updates",
        click: () => {
          void autoUpdaterController?.checkNow();
        },
      },
    ],
  };

  if (process.platform === "darwin") {
    return [
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      helpMenu,
    ];
  }

  return [{ role: "fileMenu" }, { role: "viewMenu" }, { role: "windowMenu" }, helpMenu];
}

function setupApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate()));
}

function resolveOrxaTemplateDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "orxa-template");
  }
  return path.join(process.cwd(), "assets", "orxa-template");
}

async function configureMacAppIdentity() {
  if (process.platform !== "darwin") {
    return;
  }

  app.setName("Opencode Orxa");

  const dockIconPath = path.join(process.cwd(), "build", "icon.png");
  try {
    await access(dockIconPath);
  } catch {
    return;
  }

  setTimeout(() => {
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }, 0);
}

function inferMimeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".bmp") {
    return "image/bmp";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "image/png";
}

function registerIpcHandlers() {
  ipcMain.handle(IPC.modeGet, async () => modeStore.getMode());
  ipcMain.handle(IPC.modeSet, async (_event, modeInput: unknown) => {
    const mode = assertAppMode(modeInput);
    const currentMode = modeStore.getMode();
    if (mode === currentMode) {
      return currentMode;
    }
    if (mode === "orxa") {
      await service.ensureOrxaWorkspace(resolveOrxaTemplateDir());
      await service.ensureOrxaPluginRegistration();
      return modeStore.setMode(mode);
    }
    startupBootstrap.clear();
    await service.removeOrxaPluginFromConfig();
    return modeStore.setMode(mode);
  });
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
        // Deduplicate by port
        const seen = new Set<number>();
        const unique = entries.filter((e) => {
          if (seen.has(e.port)) return false;
          seen.add(e.port);
          return true;
        });
        // If directory provided, we still return all — filtering by cwd would require
        // reading /proc which is Linux-only; on macOS we return all listening ports
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

  ipcMain.handle(IPC.updatesGetPreferences, async () =>
    autoUpdaterController?.getPreferences() ?? { autoCheckEnabled: true, releaseChannel: "stable" },
  );
  ipcMain.handle(IPC.updatesSetPreferences, async (_event, input: unknown) => {
    if (!autoUpdaterController) {
      throw new Error("Updater controller not available");
    }
    return autoUpdaterController.setPreferences(assertUpdatePreferencesInput(input));
  });
  ipcMain.handle(IPC.updatesCheckNow, async () => {
    if (!autoUpdaterController) {
      return {
        ok: true,
        status: "skipped",
        message: "Updater not initialized",
      };
    }
    return autoUpdaterController.checkNow();
  });
  ipcMain.handle(IPC.updatesDownloadAndInstall, async () => {
    if (!autoUpdaterController) {
      return {
        ok: true,
        status: "skipped",
        message: "Updater not initialized",
      };
    }
    return autoUpdaterController.downloadAndInstall();
  });

  ipcMain.handle(IPC.runtimeGetState, async () => service.runtimeState());
  ipcMain.handle(IPC.runtimeListProfiles, async () => service.listProfiles());
  ipcMain.handle(IPC.runtimeSaveProfile, async (_event, input: unknown) => service.saveProfile(assertRuntimeProfileInput(input)));
  ipcMain.handle(IPC.runtimeDeleteProfile, async (_event, profileID: unknown) =>
    service.deleteProfile(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeAttach, async (_event, profileID: unknown) => service.attach(assertString(profileID, "profileID")));
  ipcMain.handle(IPC.runtimeStartLocal, async (_event, profileID: unknown) =>
    service.startLocal(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeStopLocal, async () => service.stopLocal());

  ipcMain.handle(IPC.opencodeBootstrap, async () => {
    await startupBootstrap.wait();
    return service.bootstrap();
  });
  ipcMain.handle(IPC.opencodeCheckDependencies, async () => service.checkRuntimeDependencies());
  ipcMain.handle(IPC.opencodeAddProjectDirectory, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Add Project Folder",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return service.addProjectDirectory(result.filePaths[0]!);
  });
  ipcMain.handle(IPC.opencodeRemoveProjectDirectory, async (_event, directory: unknown) =>
    service.removeProjectDirectory(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeSelectProject, async (_event, directory: unknown) =>
    service.selectProject(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeRefreshProject, async (_event, directory: unknown) =>
    service.refreshProject(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeCreateSession, async (_event, directory: unknown, title?: unknown, permissionMode?: unknown) =>
    service.createSession(
      assertString(directory, "directory"),
      typeof title === "string" ? title : undefined,
      permissionMode === "ask-write" || permissionMode === "yolo-write" ? permissionMode : undefined,
    ),
  );
  ipcMain.handle(IPC.opencodeDeleteSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.deleteSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeAbortSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.abortSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeRenameSession, async (_event, directory: unknown, sessionID: unknown, title: unknown) =>
    service.renameSession(assertString(directory, "directory"), assertString(sessionID, "sessionID"), assertString(title, "title")),
  );
  ipcMain.handle(IPC.opencodeArchiveSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.archiveSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeCreateWorktreeSession, async (_event, directory: unknown, sessionID: unknown, name?: unknown) =>
    service.createWorktreeSession(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof name === "string" ? name : undefined,
    ),
  );
  ipcMain.handle(IPC.opencodeLoadMessages, async (_event, directory: unknown, sessionID: unknown) =>
    service.loadMessages(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeLoadExecutionLedger, async (_event, directory: unknown, sessionID: unknown, cursor?: unknown) =>
    service.loadExecutionLedger(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof cursor === "number" ? cursor : 0,
    ),
  );
  ipcMain.handle(IPC.opencodeClearExecutionLedger, async (_event, directory: unknown, sessionID: unknown) =>
    service.clearExecutionLedger(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeLoadChangeProvenance, async (_event, directory: unknown, sessionID: unknown, cursor?: unknown) =>
    service.loadChangeProvenance(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof cursor === "number" ? cursor : 0,
    ),
  );
  ipcMain.handle(IPC.opencodeGetFileProvenance, async (_event, directory: unknown, sessionID: unknown, relativePath: unknown) =>
    service.getFileProvenance(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      assertString(relativePath, "relativePath"),
    ),
  );
  ipcMain.handle(IPC.opencodeSendPrompt, async (_event, request: unknown) => service.sendPrompt(assertPromptRequestInput(request)));
  ipcMain.handle(
    IPC.opencodeReplyPermission,
    async (_event, directory: unknown, requestID: unknown, reply: unknown, message?: unknown) => {
      if (reply !== "once" && reply !== "always" && reply !== "reject") {
        throw new Error("Invalid permission reply");
      }
      return service.replyPermission(
        assertString(directory, "directory"),
        assertString(requestID, "requestID"),
        reply,
        typeof message === "string" ? message : undefined,
      );
    },
  );
  ipcMain.handle(IPC.opencodeReplyQuestion, async (_event, directory: unknown, requestID: unknown, answers: unknown) => {
    if (!Array.isArray(answers)) {
      throw new Error("answers must be an array");
    }
    return service.replyQuestion(assertString(directory, "directory"), assertString(requestID, "requestID"), answers as string[][]);
  });
  ipcMain.handle(IPC.opencodeRejectQuestion, async (_event, directory: unknown, requestID: unknown) =>
    service.rejectQuestion(assertString(directory, "directory"), assertString(requestID, "requestID")),
  );
  ipcMain.handle(IPC.opencodeGetConfig, async (_event, scope: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.getConfig(scope, typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeUpdateConfig, async (_event, scope: unknown, patch: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.updateConfig(scope, assertConfigPatch(patch), typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeReadRawConfig, async (_event, scope: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.readRawConfig(scope, typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeWriteRawConfig, async (_event, scope: unknown, content: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.writeRawConfig(scope, assertString(content, "content"), typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeListProviders, async (_event, directory?: unknown) =>
    service.listProviders(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodePickImage, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      buttonLabel: "Attach Image",
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
        },
      ],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const filePath = result.filePaths[0]!;
    return {
      path: filePath,
      filename: path.basename(filePath),
      url: pathToFileURL(filePath).toString(),
      mime: inferMimeFromPath(filePath),
    };
  });
  ipcMain.handle(IPC.opencodeGitDiff, async (_event, directory: unknown) =>
    service.gitDiff(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitLog, async (_event, directory: unknown) =>
    service.gitLog(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitIssues, async (_event, directory: unknown) =>
    service.gitIssues(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitPrs, async (_event, directory: unknown) =>
    service.gitPrs(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeOpenDirectoryIn, async (_event, directory: unknown, target: unknown) =>
    service.openDirectoryIn(assertString(directory, "directory"), assertOpenDirectoryTarget(target)),
  );
  ipcMain.handle(IPC.opencodeGitCommitSummary, async (_event, directory: unknown, includeUnstaged: unknown) =>
    service.gitCommitSummary(assertString(directory, "directory"), assertBoolean(includeUnstaged, "includeUnstaged")),
  );
  ipcMain.handle(
    IPC.opencodeGitGenerateCommitMessage,
    async (_event, directory: unknown, includeUnstaged: unknown, guidancePrompt: unknown) =>
      service.gitGenerateCommitMessage(
        assertString(directory, "directory"),
        assertBoolean(includeUnstaged, "includeUnstaged"),
        assertString(guidancePrompt, "guidancePrompt"),
      ),
  );
  ipcMain.handle(IPC.opencodeGitCommit, async (_event, directory: unknown, request: unknown) => {
    if (!request || typeof request !== "object") {
      throw new Error("Commit request is required");
    }
    const input = request as Partial<GitCommitRequest>;
    if (input.nextStep !== "commit" && input.nextStep !== "commit_and_push" && input.nextStep !== "commit_and_create_pr") {
      throw new Error("Invalid commit next step");
    }
    return service.gitCommit(assertString(directory, "directory"), {
      includeUnstaged: assertBoolean(input.includeUnstaged, "includeUnstaged"),
      message: typeof input.message === "string" ? input.message : undefined,
      guidancePrompt: typeof input.guidancePrompt === "string" ? input.guidancePrompt : undefined,
      baseBranch: typeof input.baseBranch === "string" ? input.baseBranch : undefined,
      nextStep: input.nextStep,
    });
  });
  ipcMain.handle(IPC.opencodeGitBranches, async (_event, directory: unknown) =>
    service.gitBranches(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitCheckoutBranch, async (_event, directory: unknown, branch: unknown) =>
    service.gitCheckoutBranch(assertString(directory, "directory"), assertString(branch, "branch")),
  );
  ipcMain.handle(IPC.opencodeGitStageAll, async (_event, directory: unknown) =>
    service.gitStageAll(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitRestoreAllUnstaged, async (_event, directory: unknown) =>
    service.gitRestoreAllUnstaged(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitStagePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitStagePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeGitRestorePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitRestorePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeGitUnstagePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitUnstagePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeListSkills, async () => service.listSkills());
  ipcMain.handle(IPC.opencodeReadAgentsMd, async (_event, directory: unknown) =>
    service.readAgentsMd(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeWriteAgentsMd, async (_event, directory: unknown, content: unknown) =>
    service.writeAgentsMd(assertString(directory, "directory"), assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeReadGlobalAgentsMd, async () => service.readGlobalAgentsMd());
  ipcMain.handle(IPC.opencodeWriteGlobalAgentsMd, async (_event, content: unknown) =>
    service.writeGlobalAgentsMd(assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeListAgentFiles, async () => service.listOpenCodeAgentFiles());
  ipcMain.handle(IPC.opencodeReadAgentFile, async (_event, filename: unknown) =>
    service.readOpenCodeAgentFile(assertString(filename, "filename")),
  );
  ipcMain.handle(IPC.opencodeWriteAgentFile, async (_event, filename: unknown, content: unknown) =>
    service.writeOpenCodeAgentFile(assertString(filename, "filename"), assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeDeleteAgentFile, async (_event, filename: unknown) =>
    service.deleteOpenCodeAgentFile(assertString(filename, "filename")),
  );
  ipcMain.handle(IPC.opencodeOpenFileIn, async (_event, filePath: unknown, target: unknown) =>
    service.openFileIn(assertString(filePath, "filePath"), assertOpenDirectoryTarget(target)),
  );
  ipcMain.handle(IPC.opencodeListFiles, async (_event, directory: unknown, relativePath?: unknown) =>
    service.listFiles(assertString(directory, "directory"), typeof relativePath === "string" ? relativePath : undefined),
  );
  ipcMain.handle(IPC.opencodeCountProjectFiles, async (_event, directory: unknown) =>
    service.countProjectFiles(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeReadProjectFile, async (_event, directory: unknown, relativePath: unknown) =>
    service.readProjectFile(assertString(directory, "directory"), assertString(relativePath, "relativePath")),
  );
  ipcMain.handle(IPC.opencodeArtifactsList, async (_event, query?: unknown) =>
    service.listArtifacts(assertArtifactListQuery(query)),
  );
  ipcMain.handle(IPC.opencodeArtifactsGet, async (_event, id: unknown) =>
    service.getArtifact(assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeArtifactsDelete, async (_event, id: unknown) =>
    service.deleteArtifact(assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeArtifactsListSessions, async (_event, workspace: unknown) =>
    service.listArtifactSessions(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeArtifactsListWorkspaceSummary, async (_event, workspace: unknown) =>
    service.listWorkspaceArtifactSummary(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeArtifactsGetRetention, async () => service.getArtifactRetentionPolicy());
  ipcMain.handle(IPC.opencodeArtifactsSetRetention, async (_event, input: unknown) =>
    service.setArtifactRetentionPolicy(assertArtifactRetentionUpdateInput(input)),
  );
  ipcMain.handle(IPC.opencodeArtifactsPrune, async (_event, workspace?: unknown) =>
    service.pruneArtifactsNow(typeof workspace === "string" ? workspace : undefined),
  );
  ipcMain.handle(IPC.opencodeArtifactsExportBundle, async (_event, input: unknown) =>
    service.exportArtifactBundle(assertArtifactExportBundleInput(input)),
  );
  ipcMain.handle(IPC.opencodeContextList, async (_event, workspace: unknown) =>
    service.listWorkspaceContext(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeContextRead, async (_event, workspace: unknown, id: unknown) =>
    service.readWorkspaceContext(assertString(workspace, "workspace"), assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeContextWrite, async (_event, input: unknown) =>
    service.writeWorkspaceContext(assertWorkspaceContextWriteInput(input)),
  );
  ipcMain.handle(IPC.opencodeContextDelete, async (_event, workspace: unknown, id: unknown) =>
    service.deleteWorkspaceContext(assertString(workspace, "workspace"), assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeMemoryGetSettings, async (_event, directory?: unknown) =>
    service.getMemorySettings(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryUpdateSettings, async (_event, input: unknown) =>
    service.updateMemorySettings(assertMemorySettingsUpdateInput(input)),
  );
  ipcMain.handle(IPC.opencodeMemoryListTemplates, async () => service.listMemoryTemplates());
  ipcMain.handle(IPC.opencodeMemoryApplyTemplate, async (_event, templateID: unknown, directory?: unknown, scope?: unknown) => {
    const parsedScope = scope === undefined
      ? undefined
      : scope === "global" || scope === "workspace"
        ? scope
        : (() => {
            throw new Error("Invalid memory template scope");
          })();
    return service.applyMemoryTemplate(
      assertString(templateID, "templateID"),
      typeof directory === "string" ? directory : undefined,
      parsedScope,
    );
  });
  ipcMain.handle(IPC.opencodeMemoryGetGraph, async (_event, query?: unknown) =>
    service.getMemoryGraph(assertMemoryGraphQuery(query)),
  );
  ipcMain.handle(IPC.opencodeMemoryBackfill, async (_event, directory?: unknown) =>
    service.backfillMemory(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryClearWorkspace, async (_event, directory: unknown) =>
    service.clearWorkspaceMemory(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.orxaReadConfig, async () => service.readOrxaConfig());
  ipcMain.handle(IPC.orxaWriteConfig, async (_event, content: unknown) => service.writeOrxaConfig(assertString(content, "content")));
  ipcMain.handle(IPC.orxaReadAgentPrompt, async (_event, agent: unknown) => {
    if (agent !== "orxa" && agent !== "plan") {
      throw new Error("Invalid Orxa agent");
    }
    return service.readOrxaAgentPrompt(agent);
  });
  ipcMain.handle(IPC.orxaListAgents, async () => service.listOrxaAgents());
  ipcMain.handle(IPC.orxaSaveAgent, async (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Agent input is required");
    }
    const payload = input as {
      name?: unknown;
      mode?: unknown;
      description?: unknown;
      model?: unknown;
      prompt?: unknown;
    };
    if (payload.mode !== "primary" && payload.mode !== "subagent" && payload.mode !== "all") {
      throw new Error("Invalid agent mode");
    }
    return service.saveOrxaAgent({
      name: assertString(payload.name, "name"),
      mode: payload.mode,
      description: typeof payload.description === "string" ? payload.description : undefined,
      model: typeof payload.model === "string" ? payload.model : undefined,
      prompt: typeof payload.prompt === "string" ? payload.prompt : undefined,
    });
  });
  ipcMain.handle(IPC.orxaGetAgentDetails, async (_event, name: unknown) => service.getOrxaAgentDetails(assertString(name, "name")));
  ipcMain.handle(IPC.orxaResetAgent, async (_event, name: unknown) => service.resetOrxaAgent(assertString(name, "name")));
  ipcMain.handle(IPC.orxaRestoreAgentHistory, async (_event, name: unknown, historyID: unknown) =>
    service.restoreOrxaAgentHistory(assertString(name, "name"), assertString(historyID, "historyID")),
  );
  ipcMain.handle(IPC.orxaGetServerDiagnostics, async () => service.getServerDiagnostics());
  ipcMain.handle(IPC.orxaRepairRuntime, async () => service.repairRuntime(resolveOrxaTemplateDir()));

  ipcMain.handle(IPC.terminalList, async (_event, directory: unknown) => service.listPtys(assertString(directory, "directory")));
  ipcMain.handle(IPC.terminalCreate, async (_event, directory: unknown, cwd?: unknown, title?: unknown) =>
    service.createPty(
      assertString(directory, "directory"),
      typeof cwd === "string" ? cwd : undefined,
      typeof title === "string" ? title : undefined,
    ),
  );
  ipcMain.handle(IPC.terminalConnect, async (_event, directory: unknown, ptyID: unknown) =>
    service.connectPty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );
  ipcMain.handle(IPC.terminalWrite, async (_event, directory: unknown, ptyID: unknown, data: unknown) =>
    service.writePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), typeof data === "string" ? data : ""),
  );
  ipcMain.handle(IPC.terminalResize, async (_event, directory: unknown, ptyID: unknown, cols: unknown, rows: unknown) => {
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("cols and rows must be numbers");
    }
    return service.resizePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), cols, rows);
  });
  ipcMain.handle(IPC.terminalClose, async (_event, directory: unknown, ptyID: unknown) =>
    service.closePty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );

  ipcMain.handle(IPC.browserGetState, async (event) => {
    assertBrowserSender(event);
    return requireBrowserController().getState();
  });
  ipcMain.handle(IPC.browserSetVisible, async (event, visible: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().setVisible(assertBoolean(visible, "visible"));
  });
  ipcMain.handle(IPC.browserSetBounds, async (event, bounds: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().setBounds(assertBrowserBoundsInput(bounds));
  });
  ipcMain.handle(IPC.browserOpenTab, async (event, url?: unknown, activate?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().openTab(
      typeof url === "string" ? url : undefined,
      activate === undefined ? true : assertBoolean(activate, "activate"),
    );
  });
  ipcMain.handle(IPC.browserCloseTab, async (event, tabID?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().closeTab(typeof tabID === "string" ? tabID : undefined);
  });
  ipcMain.handle(IPC.browserSwitchTab, async (event, tabID: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().switchTab(assertString(tabID, "tabID"));
  });
  ipcMain.handle(IPC.browserNavigate, async (event, url: unknown, tabID?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().navigate(assertString(url, "url"), typeof tabID === "string" ? tabID : undefined);
  });
  ipcMain.handle(IPC.browserBack, async (event, tabID?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().back(typeof tabID === "string" ? tabID : undefined);
  });
  ipcMain.handle(IPC.browserForward, async (event, tabID?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().forward(typeof tabID === "string" ? tabID : undefined);
  });
  ipcMain.handle(IPC.browserReload, async (event, tabID?: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().reload(typeof tabID === "string" ? tabID : undefined);
  });
  ipcMain.handle(IPC.browserListHistory, async (event, limit?: unknown) => {
    assertBrowserSender(event);
    const parsedLimit = limit === undefined ? undefined : Math.floor(assertFiniteNumber(limit, "limit"));
    return requireBrowserController().listHistory(parsedLimit);
  });
  ipcMain.handle(IPC.browserClearHistory, async (event) => {
    assertBrowserSender(event);
    return requireBrowserController().clearHistory();
  });
  ipcMain.handle(IPC.browserPerformAgentAction, async (event, request: unknown) => {
    assertBrowserSender(event);
    return requireBrowserController().performAgentAction(assertBrowserAgentActionRequest(request));
  });

  // ── MCP DevTools (SDK-managed) ─────────────────────────────────────
  ipcMain.handle(IPC.mcpDevToolsStart, async (event, directory: string) => {
    assertBrowserSender(event);
    let cdpPort = 0;
    try {
      cdpPort = await resolveCdpPort();
    } catch (portError) {
      const message = `CDP port resolution failed: ${portError instanceof Error ? portError.message : String(portError)}`;
      console.error("[MCP DevTools]", message);
      publishEvent({ type: "mcp.devtools.status", payload: { state: "error", cdpPort: 0, error: message } });
      return { state: "error" as const, cdpPort: 0, error: message };
    }
    try {
      console.log(`[MCP DevTools] Registering with CDP port ${cdpPort} for ${directory}`);
      await service.registerMcpDevTools(directory, cdpPort);
      console.log("[MCP DevTools] Connected successfully");
      publishEvent({ type: "mcp.devtools.status", payload: { state: "running", cdpPort } });
      return { state: "running" as const, cdpPort };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[MCP DevTools] Registration failed:", message);
      publishEvent({ type: "mcp.devtools.status", payload: { state: "error", cdpPort, error: message } });
      return { state: "error" as const, cdpPort, error: message };
    }
  });

  ipcMain.handle(IPC.mcpDevToolsStop, async (event, directory: string) => {
    assertBrowserSender(event);
    try {
      await service.disconnectMcpDevTools(directory);
    } catch {
      // ignore — may already be disconnected
    }
    publishEvent({ type: "mcp.devtools.status", payload: { state: "stopped" } });
    return { state: "stopped" as const };
  });

  ipcMain.handle(IPC.mcpDevToolsGetStatus, async (event, directory: string) => {
    assertBrowserSender(event);
    try {
      const status = await service.getMcpDevToolsStatus(directory);
      const mcpMap = status as Record<string, { status?: string }> | undefined;
      const entry = mcpMap?.["chrome-devtools"];
      if (entry?.status === "connected") {
        return { state: "running" as const };
      }
      if (entry?.status === "connecting") {
        return { state: "starting" as const };
      }
      if (entry?.status === "error") {
        return { state: "error" as const };
      }
      return { state: "stopped" as const };
    } catch {
      return { state: "stopped" as const };
    }
  });

  ipcMain.handle(IPC.mcpDevToolsListTools, async (event) => {
    assertBrowserSender(event);
    // Tools are now managed by the SDK and automatically available to the agent.
    return [];
  });
}

function flushBufferedPtyOutput(key: string) {
  const timer = ptyOutputFlushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    ptyOutputFlushTimers.delete(key);
  }
  const pending = ptyOutputBuffer.get(key);
  if (!pending) {
    return;
  }
  ptyOutputBuffer.delete(key);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(IPC.events, {
    type: "pty.output",
    payload: {
      directory: pending.directory,
      ptyID: pending.ptyID,
      chunk: pending.chunks.join(""),
    },
  } satisfies OrxaEvent);
}

function flushAllPtyOutput() {
  const keys = [...ptyOutputBuffer.keys()];
  for (const key of keys) {
    flushBufferedPtyOutput(key);
  }
}

function publishEvent(event: OrxaEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (event.type !== "pty.output") {
    mainWindow.webContents.send(IPC.events, event);
    return;
  }

  const key = `${event.payload.directory}::${event.payload.ptyID}`;
  const existing = ptyOutputBuffer.get(key);
  if (existing) {
    existing.chunks.push(event.payload.chunk);
  } else {
    ptyOutputBuffer.set(key, {
      directory: event.payload.directory,
      ptyID: event.payload.ptyID,
      chunks: [event.payload.chunk],
    });
  }

  if (!ptyOutputFlushTimers.has(key)) {
    const timer = setTimeout(() => {
      flushBufferedPtyOutput(key);
    }, PTY_OUTPUT_FLUSH_MS);
    ptyOutputFlushTimers.set(key, timer);
  }
}

async function boot() {
  await app.whenReady();
  browserController = new BrowserController({
    onEvent: (event) => publishEvent(event),
  });
  registerIpcHandlers();

  service.onEvent = (event) => publishEvent(event);

  if (process.argv.includes(SMOKE_TEST_FLAG) || process.env.ORXA_SMOKE_TEST === "1") {
    setTimeout(() => {
      app.quit();
    }, 300);
    return;
  }

  attachMainWindow(createWindow());
  void configureMacAppIdentity();
  autoUpdaterController = setupAutoUpdates(
    () => mainWindow,
    (payload) =>
      publishEvent({
        type: "updater.telemetry",
        payload,
      }),
  );
  setupApplicationMenu();

  const startupMode = modeStore.getMode();
  if (shouldRunOrxaBootstrap(startupMode)) {
    void startupBootstrap
      .start(async () => {
        await service.ensureOrxaWorkspace(resolveOrxaTemplateDir());
        await service.ensureOrxaPluginRegistration();
      })
      .catch((error) => {
        console.error("Failed to initialize Orxa workspace/plugin:", error);
      });
  }

  void service.initializeFromStoredProfile().then((runtime) => {
    if (runtime.status === "error" && runtime.lastError) {
      service.setErrorStatus(runtime.lastError);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachMainWindow(createWindow());
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    autoUpdaterController?.cleanup();
    browserController?.dispose();
    browserController = null;
    flushAllPtyOutput();
    void service.stopLocal();
  });
}

void boot();
