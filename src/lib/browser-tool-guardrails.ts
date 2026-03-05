export const BROWSER_MODE_TOOLS_POLICY: Record<string, boolean> = {
  web: false,
  "web.run": false,
  web_search: false,
  search: false,
  browse: false,
  browser: false,
  playwright: false,
  mcp: false,
  task: false,
  run: false,
  bash: false,
  exec_command: false,
};

const FORBIDDEN_TOOL_NAME_PATTERN = /\b(web|search|browse|browser|playwright|mcp|puppeteer|selenium)\b/i;

export function isForbiddenToolNameInBrowserMode(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (BROWSER_MODE_TOOLS_POLICY[normalized] === false) {
    return true;
  }
  return FORBIDDEN_TOOL_NAME_PATTERN.test(normalized);
}
