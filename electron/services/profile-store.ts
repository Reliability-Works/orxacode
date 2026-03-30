import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { RuntimeProfile, RuntimeProfileInput } from '../../shared/ipc'

type PersistedState = {
  profiles: RuntimeProfile[]
  activeProfileId?: string
}

function defaultProfile(): RuntimeProfile {
  return {
    id: randomUUID(),
    name: 'Local OpenCode',
    host: '127.0.0.1',
    port: 4096,
    https: false,
    username: 'opencode',
    hasPassword: false,
    startCommand: true,
    startHost: '127.0.0.1',
    startPort: 4096,
    corsOrigins: [],
  }
}

export class ProfileStore {
  private store = new Store<PersistedState>({
    name: 'runtime-profiles',
    defaults: {
      profiles: [defaultProfile()],
      activeProfileId: undefined,
    },
  })

  list() {
    return [...this.store.get('profiles')]
  }

  activeProfileId() {
    return this.store.get('activeProfileId')
  }

  setActiveProfileId(profileID: string | undefined) {
    this.store.set('activeProfileId', profileID)
  }

  save(profile: RuntimeProfileInput, options?: { hasPassword?: boolean }) {
    const profiles = this.list()
    const nextProfile: RuntimeProfile = {
      id: profile.id ?? randomUUID(),
      name: profile.name,
      host: profile.host,
      port: profile.port,
      https: profile.https,
      username: profile.username,
      hasPassword:
        options?.hasPassword ??
        (profile.password
          ? profile.password.length > 0
          : (profiles.find(x => x.id === profile.id)?.hasPassword ?? false)),
      startCommand: profile.startCommand,
      startHost: profile.startHost,
      startPort: profile.startPort,
      cliPath: profile.cliPath,
      corsOrigins: profile.corsOrigins,
    }

    const existing = profiles.findIndex(item => item.id === nextProfile.id)
    if (existing === -1) {
      profiles.push(nextProfile)
    } else {
      profiles[existing] = nextProfile
    }

    this.store.set('profiles', profiles)
    return profiles
  }

  remove(profileID: string) {
    const profiles = this.list().filter(item => item.id !== profileID)
    this.store.set('profiles', profiles)
    if (this.activeProfileId() === profileID) {
      this.store.set('activeProfileId', profiles[0]?.id)
    }
    return profiles
  }
}
