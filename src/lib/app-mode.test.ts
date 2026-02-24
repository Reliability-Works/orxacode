import { describe, expect, it } from "vitest";
import { preferredAgentForMode } from "./app-mode";

describe("preferredAgentForMode", () => {
  it("prefers build in standard mode when available", () => {
    expect(
      preferredAgentForMode({
        mode: "standard",
        hasOrxaAgent: true,
        hasPlanAgent: true,
        serverAgentNames: new Set(["build", "plan", "orxa"]),
        firstAgentName: "plan",
      }),
    ).toBe("build");
  });

  it("falls back to plan when it is the only standard-mode option", () => {
    expect(
      preferredAgentForMode({
        mode: "standard",
        hasOrxaAgent: false,
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("plan");
  });

  it("prefers orxa in orxa mode when present", () => {
    expect(
      preferredAgentForMode({
        mode: "orxa",
        hasOrxaAgent: true,
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan", "orxa"]),
        firstAgentName: "plan",
      }),
    ).toBe("orxa");
  });
});
