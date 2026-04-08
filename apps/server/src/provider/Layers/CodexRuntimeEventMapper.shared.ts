import type { ProviderRuntimeEvent } from '@orxa-code/contracts'

export function runtimeEvents(
  ...events: ProviderRuntimeEvent[]
): ReadonlyArray<ProviderRuntimeEvent> {
  return events
}
