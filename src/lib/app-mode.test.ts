import { describe, expect, it } from "vitest";
import { preferredAgentForMode } from "./app-mode";

describe("preferredAgentForMode", () => {
  it("prefers build when available", () => {
    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(["build", "plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("build");
  });

  it("falls back to plan when it is the only option", () => {
    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("plan");
  });

  it("returns first non-plan agent when build is absent", () => {
    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(["coder", "plan"]),
        firstAgentName: "coder",
      }),
    ).toBe("coder");
  });
});
