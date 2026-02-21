import { describe, expect, it } from "vitest";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import { findFallbackModel, listModelOptions, listModelOptionsFromConfig } from "./models";

describe("model discovery", () => {
  it("filters deprecated and disconnected models", () => {
    const providers: ProviderListResponse = {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          env: [],
          models: {
            "gpt-5": {
              id: "gpt-5",
              name: "GPT 5",
              release_date: "2026-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 200000, output: 4096 },
              options: {},
            },
            "old-model": {
              id: "old-model",
              name: "Old Model",
              release_date: "2021-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 32000, output: 2048 },
              options: {},
              status: "deprecated" as const,
            },
          },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          env: [],
          models: {},
        },
      ],
      connected: ["openai"],
      default: {},
    };

    const options = listModelOptions(providers);
    expect(options).toHaveLength(1);
    expect(options[0]?.key).toBe("openai/gpt-5");
  });

  it("chooses configured model when available", () => {
    const options = [
      {
        key: "a/one",
        providerID: "a",
        modelID: "one",
        providerName: "A",
        modelName: "One",
        variants: [],
      },
      {
        key: "b/two",
        providerID: "b",
        modelID: "two",
        providerName: "B",
        modelName: "Two",
        variants: [],
      },
    ];

    expect(findFallbackModel(options, "b/two")?.key).toBe("b/two");
    expect(findFallbackModel(options, "missing")?.key).toBe("a/one");
  });

  it("extracts model options from global config providers", () => {
    const options = listModelOptionsFromConfig({
      provider: {
        openai: {
          name: "OpenAI",
          models: {
            "gpt-5.2": {
              id: "gpt-5.2",
              name: "GPT-5.2",
            },
          },
        },
        custom: {
          models: {
            "alpha-1": {
              variants: {
                fast: {},
                precise: {},
              },
            },
          },
        },
      },
    });

    expect(options.map((item) => item.key)).toEqual(["custom/alpha-1", "openai/gpt-5.2"]);
    expect(options.find((item) => item.key === "custom/alpha-1")?.variants).toEqual(["fast", "precise"]);
  });
});
