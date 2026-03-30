import type { OrxaBridge } from '@shared/ipc'

declare global {
  const APP_VERSION: string

  interface Window {
    orxa: OrxaBridge
  }
}

export {}
