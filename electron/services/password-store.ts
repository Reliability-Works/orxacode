const SERVICE_NAME = 'orxacode-opencode'

export class PasswordStore {
  private keytarLoaded = false
  private keytar: typeof import('keytar') | undefined
  private fallback = new Map<string, string>()

  private async ensureLoaded() {
    if (this.keytarLoaded) {
      return
    }

    this.keytarLoaded = true
    try {
      this.keytar = await import('keytar')
    } catch {
      this.keytar = undefined
    }
  }

  private account(profileID: string) {
    return `profile:${profileID}`
  }

  async get(profileID: string): Promise<string | undefined> {
    await this.ensureLoaded()
    if (this.keytar) {
      const result = await this.keytar.getPassword(SERVICE_NAME, this.account(profileID))
      return result ?? undefined
    }
    return this.fallback.get(profileID)
  }

  async set(profileID: string, password: string) {
    await this.ensureLoaded()
    if (this.keytar) {
      await this.keytar.setPassword(SERVICE_NAME, this.account(profileID), password)
      return
    }
    this.fallback.set(profileID, password)
  }

  async remove(profileID: string) {
    await this.ensureLoaded()
    if (this.keytar) {
      await this.keytar.deletePassword(SERVICE_NAME, this.account(profileID))
      return
    }
    this.fallback.delete(profileID)
  }
}
