import { ChevronDown, ChevronRight } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ModelOption } from "~/lib/models";
import type { AppPreferences } from "~/types/app";

type ProviderModelsSectionProps = {
  allModelOptions: ModelOption[];
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
  collapsedProviders: Record<string, boolean>;
  setCollapsedProviders: Dispatch<SetStateAction<Record<string, boolean>>>;
};

export function ProviderModelsSection({
  allModelOptions,
  appPreferences,
  onAppPreferencesChange,
  collapsedProviders,
  setCollapsedProviders,
}: ProviderModelsSectionProps) {
  const providerMap = new Map<string, { name: string; models: { key: string; modelName: string }[] }>();
  for (const m of allModelOptions) {
    if (!providerMap.has(m.providerID)) {
      providerMap.set(m.providerID, { name: m.providerName, models: [] });
    }
    providerMap.get(m.providerID)!.models.push({ key: m.key, modelName: m.modelName });
  }
  const providers = [...providerMap.entries()];
  const hidden = new Set(appPreferences.hiddenModels);

  const toggleModel = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
  };

  const enableAll = (allKeys: string[]) => {
    const next = new Set(hidden);
    for (const k of allKeys) {
      next.delete(k);
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
  };

  const disableAll = (allKeys: string[]) => {
    const next = new Set(hidden);
    for (const k of allKeys) {
      next.add(k);
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] });
  };

  const toggleCollapse = (providerID: string) => {
    setCollapsedProviders((prev) => ({ ...prev, [providerID]: prev[providerID] === false ? true : false }));
  };

  return (
    <section className="settings-section-card settings-pad">
      <p className="raw-path" style={{ marginBottom: 0, color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.6", fontFamily: "var(--font-mono)" }}>
        // toggle which models appear in the model selector. unticked models will be hidden.
      </p>
      <div className="provider-models-list">
        {providers.map(([providerID, group]) => {
          const allKeys = group.models.map((m) => m.key);
          const visibleCount = allKeys.filter((k) => !hidden.has(k)).length;
          const isCollapsed = collapsedProviders[providerID] !== false;
          return (
            <div key={providerID} className="provider-models-group">
              <div className="provider-models-header">
                <button type="button" className="provider-models-chevron" onClick={() => toggleCollapse(providerID)}>
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <strong onClick={() => toggleCollapse(providerID)} className="provider-models-name">{group.name}</strong>
                <small>{visibleCount}/{allKeys.length} enabled</small>
                <button type="button" className="provider-models-enable-link" onClick={() => enableAll(allKeys)}>enable all</button>
                <button type="button" className="provider-models-disable-link" onClick={() => disableAll(allKeys)}>disable all</button>
              </div>
              {!isCollapsed ? (
                <div className="provider-models-items">
                  {group.models.map((m) => (
                    <label key={m.key} className="provider-models-item">
                      <input
                        type="checkbox"
                        checked={!hidden.has(m.key)}
                        onChange={() => toggleModel(m.key)}
                      />
                      <span>{m.modelName}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
