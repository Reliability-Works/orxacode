import type { OrxaEvent } from '../../shared/ipc'

type IpcRendererLike = {
  on: (
    channel: string,
    listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void
  ) => void
  removeListener: (
    channel: string,
    listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void
  ) => void
}

export function createIpcEventHub(ipcRenderer: IpcRendererLike, channels: string | string[]) {
  const eventChannels = Array.isArray(channels) ? channels : [channels]
  const listeners = new Set<(event: OrxaEvent) => void>()

  const onEvents = (_event: unknown, payload: OrxaEvent | OrxaEvent[]) => {
    const events = Array.isArray(payload) ? payload : [payload]
    for (const event of events) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }

  const ensureAttached = () => {
    if (listeners.size === 1) {
      for (const channel of eventChannels) {
        ipcRenderer.on(channel, onEvents)
      }
    }
  }

  const detachIfIdle = () => {
    if (listeners.size === 0) {
      for (const channel of eventChannels) {
        ipcRenderer.removeListener(channel, onEvents)
      }
    }
  }

  return {
    subscribe: (listener: (event: OrxaEvent) => void) => {
      listeners.add(listener)
      ensureAttached()
      return () => {
        listeners.delete(listener)
        detachIfIdle()
      }
    },
    listenerCount: () => listeners.size,
  }
}
