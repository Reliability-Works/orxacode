import { describe, expect, it } from "vitest";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import {
  filterHiddenModelOptions,
  findFallbackModel,
  listAgentOptions,
  listAllModelOptions,
  listConfiguredProviderIDs,
  listModelOptions,
  listModelOptionsFromConfig,
  listModelOptionsFromConfigReferences,
  mergeDiscoverableModelOptions,
} from "./models";

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

  it("supports shorthand provider model formats in config", () => {
    const options = listModelOptionsFromConfig({
      providers: {
        openrouter: {
          name: "OpenRouter",
          models: {
            "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
            "openai/gpt-4.1": true,
            "old-model": {
              status: "deprecated",
            },
          },
        },
        anthropic: {
          models: [
            "claude-3-7-sonnet",
            {
              id: "claude-opus-4-1",
              name: "Claude Opus 4.1",
            },
          ],
        },
      },
    });

    expect(options.map((item) => item.key)).toEqual([
      "anthropic/claude-3-7-sonnet",
      "anthropic/claude-opus-4-1",
      "openrouter/anthropic/claude-3.5-sonnet",
      "openrouter/openai/gpt-4.1",
    ]);
    expect(options.find((item) => item.key === "openrouter/anthropic/claude-3.5-sonnet")?.modelName).toBe("Claude 3.5 Sonnet");
  });

  it("collects provider ids from provider blocks and agent model strings", () => {
    const providers = listConfiguredProviderIDs({
      provider: {
        openai: {},
        google: {},
      },
      model: "openai/gpt-5.2",
      small_model: "openai/gpt-5.2-codex",
      orxa: {
        model: "kimi-for-coding/kimi-k2.5",
      },
      plan: {
        model: "openai/gpt-5.2-codex",
      },
      agent: {
        coder: {
          model: "opencode/kimi-k2.5",
        },
        reviewer: {
          model: "openai/gpt-5.2-codex",
        },
      },
    });

    expect(providers).toEqual(["google", "kimi-for-coding", "openai", "opencode"]);
  });

  it("lists all non-deprecated models regardless of provider connectivity", () => {
    const providers: ProviderListResponse = {
      all: [
        {
          id: "one",
          name: "One",
          env: [],
          models: {
            alpha: {
              id: "alpha",
              name: "Alpha",
              release_date: "2025-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 4096, output: 2048 },
              options: {},
            },
          },
        },
        {
          id: "two",
          name: "Two",
          env: [],
          models: {
            beta: {
              id: "beta",
              name: "Beta",
              release_date: "2025-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 4096, output: 2048 },
              options: {},
              status: "deprecated",
            },
          },
        },
      ],
      connected: [],
      default: {},
    };

    expect(listAllModelOptions(providers).map((item) => item.key)).toEqual(["one/alpha"]);
  });

  it("includes runtime-connected env providers in connected model options", () => {
    const providers: ProviderListResponse = {
      all: [
        {
          id: "cloudflare",
          name: "Cloudflare AI",
          env: ["CLOUDFLARE_API_KEY"],
          models: {
            "@cf/meta/llama-3.1-8b-instruct": {
              id: "@cf/meta/llama-3.1-8b-instruct",
              name: "Llama 3.1 8B Instruct",
              release_date: "2025-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 8192, output: 2048 },
              options: {},
            },
          },
        },
        {
          id: "openai",
          name: "OpenAI",
          env: [],
          models: {
            "gpt-5.2-codex": {
              id: "gpt-5.2-codex",
              name: "GPT-5.2 Codex",
              release_date: "2026-01-01",
              attachment: true,
              reasoning: true,
              temperature: true,
              tool_call: true,
              limit: { context: 200000, output: 8192 },
              options: {},
            },
          },
        },
      ],
      connected: ["cloudflare"],
      default: {},
    };

    expect(listModelOptions(providers).map((item) => item.key)).toEqual(["cloudflare/@cf/meta/llama-3.1-8b-instruct"]);
  });

  it("merges discoverable options from configured and connected sources without catalog-only models", () => {
    const configured = [
      {
        key: "openai/gpt-5.2",
        providerID: "openai",
        modelID: "gpt-5.2",
        providerName: "OpenAI",
        modelName: "GPT-5.2",
        variants: [],
      },
    ];
    const projectConnected = [
      {
        key: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
        providerID: "cloudflare",
        modelID: "@cf/meta/llama-3.1-8b-instruct",
        providerName: "Cloudflare AI",
        modelName: "Llama 3.1 8B Instruct",
        variants: [],
      },
    ];
    const globalConnected = [
      {
        key: "openai/gpt-5.2-codex",
        providerID: "openai",
        modelID: "gpt-5.2-codex",
        providerName: "OpenAI",
        modelName: "GPT-5.2 Codex",
        variants: [],
      },
    ];

    expect(mergeDiscoverableModelOptions(configured, projectConnected, globalConnected).map((item) => item.key)).toEqual([
      "cloudflare/@cf/meta/llama-3.1-8b-instruct",
      "openai/gpt-5.2",
      "openai/gpt-5.2-codex",
    ]);
  });

  it("composer options match settings options exactly when no models are hidden", () => {
    const settingsOptions = mergeDiscoverableModelOptions(
      [
        {
          key: "openai/gpt-5.2",
          providerID: "openai",
          modelID: "gpt-5.2",
          providerName: "OpenAI",
          modelName: "GPT-5.2",
          variants: [],
        },
      ],
      [
        {
          key: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
          providerID: "cloudflare",
          modelID: "@cf/meta/llama-3.1-8b-instruct",
          providerName: "Cloudflare AI",
          modelName: "Llama 3.1 8B Instruct",
          variants: [],
        },
      ],
    );

    expect(filterHiddenModelOptions(settingsOptions, []).map((item) => item.key)).toEqual(settingsOptions.map((item) => item.key));
  });

  it("filters hidden models from composer options while retaining settings discoverability", () => {
    const settingsOptions = [
      {
        key: "openai/gpt-5.2",
        providerID: "openai",
        modelID: "gpt-5.2",
        providerName: "OpenAI",
        modelName: "GPT-5.2",
        variants: [],
      },
      {
        key: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
        providerID: "cloudflare",
        modelID: "@cf/meta/llama-3.1-8b-instruct",
        providerName: "Cloudflare AI",
        modelName: "Llama 3.1 8B Instruct",
        variants: [],
      },
    ];

    expect(filterHiddenModelOptions(settingsOptions, ["cloudflare/@cf/meta/llama-3.1-8b-instruct"]).map((item) => item.key)).toEqual([
      "openai/gpt-5.2",
    ]);
    expect(settingsOptions.map((item) => item.key)).toEqual([
      "openai/gpt-5.2",
      "cloudflare/@cf/meta/llama-3.1-8b-instruct",
    ]);
  });

  it("filters hidden and subagent definitions from agent list", () => {
    const options = listAgentOptions([
      {
        name: "orxa",
        mode: "all",
        model: { providerID: "openai", modelID: "gpt-5" },
      },
      {
        name: "hidden",
        mode: "all",
        model: "openai/gpt-4.1",
        hidden: true,
      },
      {
        name: "sub",
        mode: "subagent",
        model: "openai/gpt-4.1",
      },
    ] as never);

    expect(options).toEqual([
      {
        name: "orxa",
        model: "openai/gpt-5",
        description: undefined,
      },
    ]);
  });

  it("handles invalid model configuration shapes safely", () => {
    expect(listModelOptionsFromConfig(null)).toEqual([]);
    expect(listModelOptionsFromConfig([])).toEqual([]);
    expect(listModelOptionsFromConfig({ providers: { one: { models: false } } })).toEqual([]);
    expect(listConfiguredProviderIDs({ model: "invalid" })).toEqual([]);
  });

  it("extracts only explicit model references from config", () => {
    const options = listModelOptionsFromConfigReferences({
      model: "openai/gpt-5.2",
      small_model: "openai/gpt-5.2-codex",
      provider: {
        openai: {
          models: {
            "gpt-5.2": true,
            "gpt-5.2-codex": true,
          },
        },
        alibaba: {
          models: {
            "qwen-max": true,
          },
        },
      },
      agent: {
        reviewer: {
          model: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
        },
      },
    });

    expect(options.map((item) => item.key)).toEqual([
      "cloudflare/@cf/meta/llama-3.1-8b-instruct",
      "openai/gpt-5.2",
      "openai/gpt-5.2-codex",
    ]);
  });
});
