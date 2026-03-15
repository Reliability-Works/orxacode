export const BROWSER_MODE_TOOLS_POLICY: Record<string, boolean> = {
  web: false,
  "web.run": false,
  web_search: false,
  search: false,
  browse: false,
  playwright: false,
  puppeteer: false,
  selenium: false,
};

// When MCP DevTools is connected, we don't apply browser tool restrictions
// because the chrome-devtools-mcp tools ARE the browser tools.
export const BROWSER_MODE_TOOLS_POLICY_WITH_MCP: Record<string, boolean> = {};

export const MEMORY_MODE_TOOLS_POLICY: Record<string, boolean> = {
  supermemory: false,
  "supermemory.search": false,
  "supermemory.retrieve": false,
  mem0: false,
  pinecone: false,
  qdrant: false,
  weaviate: false,
  chroma: false,
  chromadb: false,
  milvus: false,
};

export const PLAN_MODE_TOOLS_POLICY: Record<string, boolean> = {
  edit: false,
  write: false,
  apply_patch: false,
  bash: false,
  run: false,
  exec_command: false,
  delete: false,
  remove: false,
};

const FORBIDDEN_TOOL_NAME_PATTERN = /(web_search|browse_web|playwright|puppeteer|selenium)/i;
const FORBIDDEN_MEMORY_TOOL_NAME_PATTERN = /(supermemory|mem0|pinecone|qdrant|weaviate|chroma|chromadb|milvus|vector\s*db)/i;
const FORBIDDEN_PLAN_TOOL_NAME_PATTERN = /(edit|write|apply[_-]?patch|bash|exec|shell|run|delete|remove|rm|mv)/i;

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

export function isForbiddenToolNameInMemoryMode(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (MEMORY_MODE_TOOLS_POLICY[normalized] === false) {
    return true;
  }
  return FORBIDDEN_MEMORY_TOOL_NAME_PATTERN.test(normalized);
}

export function mergeModeToolPolicies(...policies: Array<Record<string, boolean> | undefined>) {
  const merged: Record<string, boolean> = {};
  for (const policy of policies) {
    if (!policy) {
      continue;
    }
    Object.assign(merged, policy);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function isForbiddenToolNameInPlanMode(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (PLAN_MODE_TOOLS_POLICY[normalized] === false) {
    return true;
  }
  return FORBIDDEN_PLAN_TOOL_NAME_PATTERN.test(normalized);
}
