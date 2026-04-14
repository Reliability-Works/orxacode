import type { BrowserWindow } from 'electron'

import { resolveResourcePath } from './main.identity'
import type { CreateWindowHost } from './main.window'

export function resolveDesktopIconPath(
  rootDir: string,
  ext: 'ico' | 'icns' | 'png'
): string | null {
  return resolveResourcePath(rootDir, `icon.${ext}`)
}

export function createDesktopWindowHost(input: {
  readonly displayName: string
  readonly desktopScheme: string
  readonly isDevelopment: boolean
  getBackendPort(): number | null
  shouldDeferInitialLoad(): boolean
  resolveIconPath(ext: 'ico' | 'icns' | 'png'): string | null
  notifyDidFinishLoad(): void
  setMainWindow(window: BrowserWindow | null): void
  isMainWindow(window: BrowserWindow): boolean
}): CreateWindowHost {
  return {
    get config() {
      return {
        displayName: input.displayName,
        desktopScheme: input.desktopScheme,
        isDevelopment: input.isDevelopment,
        backendPort: input.getBackendPort(),
        deferInitialLoad: input.shouldDeferInitialLoad(),
      }
    },
    resolveIconPath: input.resolveIconPath,
    notifyDidFinishLoad: input.notifyDidFinishLoad,
    setMainWindow: input.setMainWindow,
    isMainWindow: input.isMainWindow,
  }
}
