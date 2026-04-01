import type { RuntimeProfileInput } from '@shared/ipc'

export type AppGlobalDialogsProfileActions = {
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>
  onDeleteProfile: (profileID: string) => Promise<void>
  onAttachProfile: (profileID: string) => Promise<void>
  onStartLocalProfile: (profileID: string) => Promise<void>
  onStopLocalProfile: () => Promise<void>
}

export function buildGlobalDialogsProfileActions(args: {
  refreshProfiles: () => Promise<void>
  refreshConfigModels: () => Promise<void>
  refreshGlobalProviders: () => Promise<void>
  refreshGlobalAgents: () => Promise<void>
  refreshAgentFiles: () => Promise<void>
  bootstrap: () => Promise<void>
  setStatusLine: (value: string) => void
}): AppGlobalDialogsProfileActions {
  const {
    refreshProfiles,
    refreshConfigModels,
    refreshGlobalProviders,
    refreshGlobalAgents,
    refreshAgentFiles,
    bootstrap,
    setStatusLine,
  } = args

  return {
    onSaveProfile: async profile => {
      await window.orxa.runtime.saveProfile(profile)
      await refreshProfiles()
      setStatusLine('Profile saved')
    },
    onDeleteProfile: async profileID => {
      await window.orxa.runtime.deleteProfile(profileID)
      await refreshProfiles()
      setStatusLine('Profile deleted')
    },
    onAttachProfile: async profileID => {
      await window.orxa.runtime.attach(profileID)
      await refreshProfiles()
      await Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshGlobalAgents(),
        refreshAgentFiles(),
      ])
      await bootstrap()
      setStatusLine('Attached to server')
    },
    onStartLocalProfile: async profileID => {
      await window.orxa.runtime.startLocal(profileID)
      await refreshProfiles()
      await Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshGlobalAgents(),
        refreshAgentFiles(),
      ])
      await bootstrap()
      setStatusLine('Local server started')
    },
    onStopLocalProfile: async () => {
      await window.orxa.runtime.stopLocal()
      await refreshProfiles()
      await Promise.all([
        refreshConfigModels(),
        refreshGlobalProviders(),
        refreshGlobalAgents(),
        refreshAgentFiles(),
      ])
      setStatusLine('Local server stopped')
    },
  }
}
