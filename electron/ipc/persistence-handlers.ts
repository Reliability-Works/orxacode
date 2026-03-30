import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { PersistenceService } from '../services/persistence-service'

type PersistenceHandlersDeps = {
  service: PersistenceService
}

export function registerPersistenceHandlers({ service }: PersistenceHandlersDeps) {
  ipcMain.on(IPC.persistenceGet, (event, key: unknown) => {
    if (typeof key !== 'string') {
      throw new Error('key must be a string')
    }
    event.returnValue = service.getRendererValue(key)
  })

  ipcMain.on(IPC.persistenceSet, (event, key: unknown, value: unknown) => {
    if (typeof key !== 'string') {
      console.warn('[persistence] set called with non-string key, ignoring')
      event.returnValue = false
      return
    }
    if (typeof value !== 'string') {
      console.warn(`[persistence] set called with non-string value for key "${key}", ignoring`)
      event.returnValue = false
      return
    }
    service.setRendererValue(key, value)
    event.returnValue = true
  })

  ipcMain.on(IPC.persistenceRemove, (event, key: unknown) => {
    if (typeof key !== 'string') {
      throw new Error('key must be a string')
    }
    service.removeRendererValue(key)
    event.returnValue = true
  })
}
