import type { OrxaEvent } from "../../shared/ipc";

type IpcRendererLike = {
  on: (channel: string, listener: (event: unknown, payload: OrxaEvent) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, payload: OrxaEvent) => void) => void;
};

export function createIpcEventHub(ipcRenderer: IpcRendererLike, channel: string) {
  const listeners = new Set<(event: OrxaEvent) => void>();

  const onEvents = (_event: unknown, payload: OrxaEvent) => {
    for (const listener of listeners) {
      listener(payload);
    }
  };

  const ensureAttached = () => {
    if (listeners.size === 1) {
      ipcRenderer.on(channel, onEvents);
    }
  };

  const detachIfIdle = () => {
    if (listeners.size === 0) {
      ipcRenderer.removeListener(channel, onEvents);
    }
  };

  return {
    subscribe: (listener: (event: OrxaEvent) => void) => {
      listeners.add(listener);
      ensureAttached();
      return () => {
        listeners.delete(listener);
        detachIfIdle();
      };
    },
    listenerCount: () => listeners.size,
  };
}
