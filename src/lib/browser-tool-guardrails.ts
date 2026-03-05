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

const FORBIDDEN_TOOL_NAME_PATTERN = /(web|search|browse|browser|playwright|mcp|puppeteer|selenium)/i;
const FORBIDDEN_MEMORY_TOOL_NAME_PATTERN = /(supermemory|mem0|pinecone|qdrant|weaviate|chroma|chromadb|milvus|vector\s*db)/i;

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
