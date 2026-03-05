import { describe, expect, it } from "vitest";
import {
  BROWSER_MODE_TOOLS_POLICY,
  MEMORY_MODE_TOOLS_POLICY,
  isForbiddenToolNameInBrowserMode,
  isForbiddenToolNameInMemoryMode,
  mergeModeToolPolicies,
} from "./browser-tool-guardrails";

describe("browser-tool-guardrails", () => {
  it("flags forbidden browser-mode tools", () => {
    expect(isForbiddenToolNameInBrowserMode("web_search")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("playwright_click")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("todowrite")).toBe(false);
  });

  it("flags forbidden memory-mode tools", () => {
    expect(isForbiddenToolNameInMemoryMode("supermemory_search")).toBe(true);
    expect(isForbiddenToolNameInMemoryMode("pinecone_query")).toBe(true);
    expect(isForbiddenToolNameInMemoryMode("todowrite")).toBe(false);
  });

  it("merges active mode tool policies without returning empty maps", () => {
    const merged = mergeModeToolPolicies(MEMORY_MODE_TOOLS_POLICY, BROWSER_MODE_TOOLS_POLICY);
    expect(merged).toBeDefined();
    expect(merged).toEqual(
      expect.objectContaining({
        supermemory: false,
        web_search: false,
      }),
    );
    expect(mergeModeToolPolicies(undefined, undefined)).toBeUndefined();
  });
});

