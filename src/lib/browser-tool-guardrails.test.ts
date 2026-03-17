import { describe, expect, it } from "vitest";
import {
  BROWSER_MODE_TOOLS_POLICY,
  PLAN_MODE_TOOLS_POLICY,
  isForbiddenToolNameInBrowserMode,
  isForbiddenToolNameInPlanMode,
  mergeModeToolPolicies,
} from "./browser-tool-guardrails";

describe("browser-tool-guardrails", () => {
  it("flags forbidden browser-mode tools", () => {
    expect(isForbiddenToolNameInBrowserMode("web_search")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("playwright")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("puppeteer")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("selenium")).toBe(true);
    expect(isForbiddenToolNameInBrowserMode("todowrite")).toBe(false);
    // MCP tools should NOT be blocked (chrome-devtools-mcp)
    expect(isForbiddenToolNameInBrowserMode("navigate_page")).toBe(false);
    expect(isForbiddenToolNameInBrowserMode("take_screenshot")).toBe(false);
  });

  it("flags forbidden plan-mode write/edit tools", () => {
    expect(isForbiddenToolNameInPlanMode("apply_patch")).toBe(true);
    expect(isForbiddenToolNameInPlanMode("exec_command")).toBe(true);
    expect(isForbiddenToolNameInPlanMode("read_file")).toBe(false);
  });

  it("merges active mode tool policies without returning empty maps", () => {
    const merged = mergeModeToolPolicies(PLAN_MODE_TOOLS_POLICY, BROWSER_MODE_TOOLS_POLICY);
    expect(merged).toBeDefined();
    expect(merged).toEqual(
      expect.objectContaining({
        apply_patch: false,
        web_search: false,
      }),
    );
    expect(mergeModeToolPolicies(undefined, undefined)).toBeUndefined();
  });
});
