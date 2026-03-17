import type { OpenDirectoryTarget, PromptRequest, RuntimeProfileInput, UpdatePreferences } from "../../shared/ipc";

import { assertBoolean, assertString, assertStringArray } from "./validators-core";

export function assertOpenDirectoryTarget(value: unknown): OpenDirectoryTarget {
  const allowed: OpenDirectoryTarget[] = ["cursor", "antigravity", "finder", "terminal", "ghostty", "xcode", "zed"];
  if (typeof value !== "string" || !allowed.includes(value as OpenDirectoryTarget)) {
    throw new Error("Invalid open target");
  }
  return value as OpenDirectoryTarget;
}

export function assertUpdatePreferencesInput(input: unknown): Partial<UpdatePreferences> {
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

export function assertRuntimeProfileInput(value: unknown): RuntimeProfileInput {
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

export function assertConfigPatch(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config patch must be an object");
  }
  return assertSafeJsonValue(value, "patch") as Record<string, unknown>;
}

export function assertPromptRequestInput(value: unknown): PromptRequest {
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
    promptSource?: unknown;
    tools?: unknown;
  };

  const text = assertString(payload.text, "text");
  if (text.length > 64_000) {
    throw new Error("text exceeds maximum length");
  }

  const result: PromptRequest = {
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
