import type { Agent, ProviderListResponse } from "@opencode-ai/sdk/v2/client";

export type ModelOption = {
  key: string;
  providerID: string;
  modelID: string;
  providerName: string;
  modelName: string;
  variants: string[];
};

export function listAgentOptions(agents: Agent[]) {
  const resolveModel = (model: Agent["model"]): string | undefined => {
    if (!model) {
      return undefined;
    }
    if (typeof model === "string") {
      return model;
    }
    if (typeof model === "object" && "providerID" in model && "modelID" in model) {
      return `${model.providerID}/${model.modelID}`;
    }
    return undefined;
  };

  return agents
    .filter((agent) => (agent as { hidden?: boolean }).hidden !== true)
    .filter((agent) => agent.mode !== "subagent")
    .map((agent) => ({
      name: agent.name,
      model: resolveModel(agent.model),
      description: agent.description,
    }));
}

export function listModelOptions(providers: ProviderListResponse): ModelOption[] {
  const connected = new Set(providers.connected);
  const options: ModelOption[] = [];

  for (const provider of providers.all) {
    if (!connected.has(provider.id)) {
      continue;
    }

    for (const model of Object.values(provider.models)) {
      if (model.status === "deprecated") {
        continue;
      }

      options.push({
        key: `${provider.id}/${model.id}`,
        providerID: provider.id,
        modelID: model.id,
        providerName: provider.name,
        modelName: model.name,
        variants: model.variants ? Object.keys(model.variants) : [],
      });
    }
  }

  return options.sort((a, b) => a.key.localeCompare(b.key));
}

export function findFallbackModel(options: ModelOption[], configured?: string) {
  if (configured) {
    const match = options.find((item) => item.key === configured);
    if (match) {
      return match;
    }
  }

  return options[0];
}

export function listModelOptionsFromConfig(config: unknown): ModelOption[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [];
  }
  const root = config as { provider?: Record<string, unknown> };
  const providers = root.provider;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return [];
  }

  const options: ModelOption[] = [];
  for (const [providerID, providerValue] of Object.entries(providers)) {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
      continue;
    }
    const provider = providerValue as { name?: unknown; models?: Record<string, unknown> };
    const providerName = typeof provider.name === "string" && provider.name.trim().length > 0 ? provider.name : providerID;
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) {
      continue;
    }

    for (const [modelID, modelValue] of Object.entries(models)) {
      if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) {
        continue;
      }
      const model = modelValue as {
        id?: unknown;
        name?: unknown;
        status?: unknown;
        variants?: Record<string, unknown>;
      };
      if (model.status === "deprecated") {
        continue;
      }
      const resolvedModelID = typeof model.id === "string" && model.id.trim().length > 0 ? model.id : modelID;
      const modelName = typeof model.name === "string" && model.name.trim().length > 0 ? model.name : resolvedModelID;
      const variants = model.variants && typeof model.variants === "object" && !Array.isArray(model.variants)
        ? Object.keys(model.variants)
        : [];
      options.push({
        key: `${providerID}/${resolvedModelID}`,
        providerID,
        modelID: resolvedModelID,
        providerName,
        modelName,
        variants,
      });
    }
  }

  return options.sort((a, b) => a.key.localeCompare(b.key));
}
