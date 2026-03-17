export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEPENDENCY_CHECK_TIMEOUT_MS = 6_000;
export const OPENCODE_SOURCE_URL = "https://github.com/anomalyco/opencode";
export const OPENCODE_INSTALL_COMMAND = "npm install -g opencode-ai";

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function sanitizeError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  return raw
    .replace(/https?:\/\/[^\s)]+/gi, "[server]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[server]");
}

export function isMissingGhCliError(error: unknown) {
  const normalized = sanitizeError(error).toLowerCase();
  return (
    /spawn\s+.*\bgh\b.*\benoent\b/.test(normalized) ||
    normalized.includes("gh: command not found") ||
    normalized.includes("'gh' is not recognized as an internal or external command")
  );
}

export function isGhAuthError(error: unknown) {
  const normalized = sanitizeError(error).toLowerCase();
  return (
    normalized.includes("not logged into any github hosts") ||
    normalized.includes("try authenticating with") ||
    normalized.includes("authentication required")
  );
}

export function isTransientPromptError(error: unknown) {
  const normalized = sanitizeError(error).toLowerCase();
  return (
    normalized.includes("und_err_headers_timeout") ||
    normalized.includes("headers timeout") ||
    normalized.includes("fetch failed") ||
    normalized.includes("socket hang up") ||
    normalized.includes("econnreset")
  );
}
