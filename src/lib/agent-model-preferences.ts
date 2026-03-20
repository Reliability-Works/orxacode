export function syncAgentModelPreference(
  current: Record<string, string>,
  agentName: string,
  model: string | undefined,
): Record<string, string> {
  const trimmedModel = model?.trim();
  if (trimmedModel && trimmedModel.length > 0) {
    if (current[agentName] === trimmedModel) {
      return current;
    }
    return {
      ...current,
      [agentName]: trimmedModel,
    };
  }

  if (!(agentName in current)) {
    return current;
  }

  const next = { ...current };
  delete next[agentName];
  return next;
}
