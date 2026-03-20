import type { Agent, ProviderListResponse } from "@opencode-ai/sdk/v2/client";

export type ModelOption = {
  key: string;
  providerID: string;
  modelID: string;
  providerName: string;
  modelName: string;
  variants: string[];
};

type ProviderLike = {
  id?: unknown;
  name?: unknown;
  models?: unknown;
};

type ProviderModelLike = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  variants?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listConnectedProviderIDs(providers: ProviderListResponse): string[] {
  return Array.isArray(providers.connected)
    ? providers.connected.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function listProviderEntries(providers: ProviderListResponse): Array<{ id: string; name: string; models: ProviderModelLike[] }> {
  if (!Array.isArray(providers.all)) {
    return [];
  }

  return providers.all.flatMap((providerValue) => {
    if (!isRecord(providerValue)) {
      return [];
    }

    const provider = providerValue as ProviderLike;
    if (typeof provider.id !== "string" || provider.id.trim().length === 0) {
      return [];
    }

    const providerID = provider.id;
    const providerName = typeof provider.name === "string" && provider.name.trim().length > 0
      ? provider.name
      : providerID;
    const modelValues = isRecord(provider.models) ? Object.values(provider.models) : [];
    const models = modelValues.filter((model): model is ProviderModelLike => isRecord(model));

    return [{ id: providerID, name: providerName, models }];
  });
}

export function mergeDiscoverableModelOptions(...sources: Array<ModelOption[]>) {
  const unique = new Map<string, ModelOption>();
  for (const source of sources) {
    for (const option of source) {
      if (!unique.has(option.key)) {
        unique.set(option.key, option);
      }
    }
  }
  return [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function filterHiddenModelOptions(options: ModelOption[], hiddenModelKeys: string[]) {
  if (hiddenModelKeys.length === 0) {
    return options;
  }
  const hidden = new Set(hiddenModelKeys);
  return options.filter((item) => !hidden.has(item.key));
}

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
  const connected = new Set(listConnectedProviderIDs(providers));
  const options: ModelOption[] = [];

  for (const provider of listProviderEntries(providers)) {
    if (!connected.has(provider.id)) {
      continue;
    }

    for (const model of provider.models) {
      if (typeof model.id !== "string" || model.id.trim().length === 0) {
        continue;
      }
      if (model.status === "deprecated") {
        continue;
      }

      options.push({
        key: `${provider.id}/${model.id}`,
        providerID: provider.id,
        modelID: model.id,
        providerName: provider.name,
        modelName: typeof model.name === "string" && model.name.trim().length > 0 ? model.name : model.id,
        variants: isRecord(model.variants) ? Object.keys(model.variants) : [],
      });
    }
  }

  return options.sort((a, b) => a.key.localeCompare(b.key));
}

export function listAllModelOptions(providers: ProviderListResponse): ModelOption[] {
  const options: ModelOption[] = [];

  for (const provider of listProviderEntries(providers)) {
    for (const model of provider.models) {
      if (typeof model.id !== "string" || model.id.trim().length === 0) {
        continue;
      }
      if (model.status === "deprecated") {
        continue;
      }

      options.push({
        key: `${provider.id}/${model.id}`,
        providerID: provider.id,
        modelID: model.id,
        providerName: provider.name,
        modelName: typeof model.name === "string" && model.name.trim().length > 0 ? model.name : model.id,
        variants: isRecord(model.variants) ? Object.keys(model.variants) : [],
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
  const root = config as { provider?: Record<string, unknown>; providers?: Record<string, unknown> };
  const providers = root.provider ?? root.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return [];
  }

  const optionMap = new Map<string, ModelOption>();
  const pushOption = (option: ModelOption) => {
    if (!optionMap.has(option.key)) {
      optionMap.set(option.key, option);
    }
  };

  const parseModelObject = (
    providerID: string,
    providerName: string,
    fallbackModelID: string,
    modelValue: unknown,
  ): ModelOption | null => {
    if (typeof modelValue === "string") {
      const modelID = fallbackModelID;
      const modelName = modelValue.trim().length > 0 ? modelValue.trim() : modelID;
      return {
        key: `${providerID}/${modelID}`,
        providerID,
        modelID,
        providerName,
        modelName,
        variants: [],
      };
    }

    if (typeof modelValue === "boolean") {
      if (!modelValue) {
        return null;
      }
      return {
        key: `${providerID}/${fallbackModelID}`,
        providerID,
        modelID: fallbackModelID,
        providerName,
        modelName: fallbackModelID,
        variants: [],
      };
    }

    if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) {
      return null;
    }

    const model = modelValue as {
      id?: unknown;
      name?: unknown;
      status?: unknown;
      variants?: Record<string, unknown>;
    };

    if (model.status === "deprecated") {
      return null;
    }

    const modelID = typeof model.id === "string" && model.id.trim().length > 0 ? model.id : fallbackModelID;
    const modelName = typeof model.name === "string" && model.name.trim().length > 0 ? model.name : modelID;
    const variants = model.variants && typeof model.variants === "object" && !Array.isArray(model.variants)
      ? Object.keys(model.variants)
      : [];

    return {
      key: `${providerID}/${modelID}`,
      providerID,
      modelID,
      providerName,
      modelName,
      variants,
    };
  };

  for (const [providerID, providerValue] of Object.entries(providers)) {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
      continue;
    }
    const provider = providerValue as { name?: unknown; models?: Record<string, unknown> };
    const providerName = typeof provider.name === "string" && provider.name.trim().length > 0 ? provider.name : providerID;
    const models = provider.models;
    if (!models) {
      continue;
    }

    if (Array.isArray(models)) {
      for (const modelValue of models) {
        if (typeof modelValue === "string") {
          const modelID = modelValue.trim();
          if (!modelID) {
            continue;
          }
          pushOption({
            key: `${providerID}/${modelID}`,
            providerID,
            modelID,
            providerName,
            modelName: modelID,
            variants: [],
          });
          continue;
        }

        if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) {
          continue;
        }

        const item = modelValue as { id?: unknown; name?: unknown; status?: unknown; variants?: Record<string, unknown> };
        const fallbackModelID = typeof item.id === "string" && item.id.trim().length > 0
          ? item.id
          : (typeof item.name === "string" && item.name.trim().length > 0 ? item.name : "");
        if (!fallbackModelID) {
          continue;
        }
        const parsed = parseModelObject(providerID, providerName, fallbackModelID, item);
        if (parsed) {
          pushOption(parsed);
        }
      }
      continue;
    }

    if (typeof models !== "object") {
      continue;
    }

    for (const [modelID, modelValue] of Object.entries(models)) {
      const fallbackModelID = modelID.trim();
      if (!fallbackModelID) {
        continue;
      }
      const parsed = parseModelObject(providerID, providerName, fallbackModelID, modelValue);
      if (parsed) {
        pushOption(parsed);
      }
    }
  }

  return [...optionMap.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function listModelOptionsFromConfigReferences(config: unknown): ModelOption[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [];
  }

  const options = new Map<string, ModelOption>();
  const root = config as Record<string, unknown>;
  const add = (raw: unknown) => {
    if (typeof raw !== "string") {
      return;
    }
    const value = raw.trim();
    if (!value) {
      return;
    }
    const [providerID, ...modelParts] = value.split("/");
    const modelID = modelParts.join("/");
    if (!providerID || !modelID) {
      return;
    }
    const key = `${providerID}/${modelID}`;
    if (options.has(key)) {
      return;
    }
    options.set(key, {
      key,
      providerID,
      modelID,
      providerName: providerID,
      modelName: modelID,
      variants: [],
    });
  };

  add(root.model);
  add(root.small_model);
  if (root.orxa && typeof root.orxa === "object" && !Array.isArray(root.orxa)) {
    add((root.orxa as Record<string, unknown>).model);
  }
  if (root.plan && typeof root.plan === "object" && !Array.isArray(root.plan)) {
    add((root.plan as Record<string, unknown>).model);
  }
  if (root.agent && typeof root.agent === "object" && !Array.isArray(root.agent)) {
    for (const value of Object.values(root.agent as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      add((value as Record<string, unknown>).model);
    }
  }

  return [...options.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function listConfiguredProviderIDs(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [];
  }

  const ids = new Set<string>();
  const root = config as Record<string, unknown>;

  const providers = root.provider ?? root.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    for (const providerID of Object.keys(providers)) {
      const trimmed = providerID.trim();
      if (trimmed.length > 0) {
        ids.add(trimmed);
      }
    }
  }

  const collectFromModel = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const [providerID, ...modelParts] = value.split("/");
    if (!providerID || modelParts.length === 0) {
      return;
    }
    const trimmed = providerID.trim();
    if (trimmed.length > 0) {
      ids.add(trimmed);
    }
  };

  collectFromModel(root.model);
  collectFromModel(root.small_model);

  const orxa = root.orxa;
  if (orxa && typeof orxa === "object" && !Array.isArray(orxa)) {
    collectFromModel((orxa as { model?: unknown }).model);
  }

  const plan = root.plan;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    collectFromModel((plan as { model?: unknown }).model);
  }

  const agents = root.agent;
  if (agents && typeof agents === "object" && !Array.isArray(agents)) {
    for (const definition of Object.values(agents)) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        continue;
      }
      collectFromModel((definition as { model?: unknown }).model);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}
