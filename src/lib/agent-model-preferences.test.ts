import { describe, expect, it } from "vitest";
import { syncAgentModelPreference } from "./agent-model-preferences";

describe("syncAgentModelPreference", () => {
  it("updates the cached model for an agent when a new model is saved", () => {
    const result = syncAgentModelPreference({ build: "openai/gpt-5.2" }, "build", "openai/gpt-5.3-codex");
    expect(result).toEqual({ build: "openai/gpt-5.3-codex" });
  });

  it("removes stale cached model when saved model is blank", () => {
    const result = syncAgentModelPreference({ build: "openai/gpt-5.2", plan: "openai/gpt-5-mini" }, "build", " ");
    expect(result).toEqual({ plan: "openai/gpt-5-mini" });
  });

  it("keeps preferences unchanged when agent has no cached model and saved model is empty", () => {
    const current = { plan: "openai/gpt-5-mini" };
    const result = syncAgentModelPreference(current, "build", undefined);
    expect(result).toBe(current);
  });
});
