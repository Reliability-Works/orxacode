import { resolveRemoteAccessSnapshot } from './remoteAccess'
import type { DesktopRemoteAccessPreferencesStore } from './remoteAccessPreferences'
import { resolveTailscaleServeHostname } from './tailscaleServe'

interface ResolveDesktopRemoteAccessSnapshotInput {
  backendPort: number
  remoteAccessBootstrapToken: string | undefined
  remoteAccessEnvironmentId: string | undefined
  store: DesktopRemoteAccessPreferencesStore
}

export function resolveDesktopRemoteAccessSnapshot(input: ResolveDesktopRemoteAccessSnapshotInput) {
  const remoteAccessState = input.store.get()
  return resolveRemoteAccessSnapshot({
    enabled: remoteAccessState.enabled,
    environmentId: input.remoteAccessEnvironmentId ?? remoteAccessState.environmentId ?? '',
    bootstrapToken: input.remoteAccessBootstrapToken ?? null,
    port: input.backendPort,
    tailscaleServeHostname: resolveTailscaleServeHostname({
      backendPort: input.backendPort,
    }),
  })
}
