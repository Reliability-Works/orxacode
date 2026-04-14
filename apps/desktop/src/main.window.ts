import * as Path from 'node:path'

import { app, BrowserWindow, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { getSafeExternalUrl } from './main.logging'

export interface CreateWindowConfig {
  readonly displayName: string
  readonly desktopScheme: string
  readonly isDevelopment: boolean
  readonly backendPort: number | null
  readonly deferInitialLoad?: boolean
}

export interface CreateWindowHost {
  readonly config: CreateWindowConfig
  resolveIconPath(ext: 'ico' | 'icns' | 'png'): string | null
  notifyDidFinishLoad(): void
  setMainWindow(window: BrowserWindow | null): void
  isMainWindow(window: BrowserWindow): boolean
}

const appContentRequestedWindows = new WeakSet<BrowserWindow>()

function getIconOption(host: CreateWindowHost): { icon: string } | Record<string, never> {
  if (process.platform === 'darwin') return {}
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const iconPath = host.resolveIconPath(ext)
  return iconPath ? { icon: iconPath } : {}
}

function attachContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const menuTemplate: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion),
        })
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: 'No suggestions', enabled: false })
      }
      menuTemplate.push({ type: 'separator' })
    }
    menuTemplate.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
    Menu.buildFromTemplate(menuTemplate).popup({ window })
  })
}

function attachWindowOpenHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url)
    if (externalUrl) {
      void shell.openExternal(externalUrl)
    }
    return { action: 'deny' }
  })
}

export function loadMainWindowContent(window: BrowserWindow, config: CreateWindowConfig): void {
  appContentRequestedWindows.add(window)
  if (config.isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    window.webContents.openDevTools({ mode: 'detach' })
    return
  }

  if (config.backendPort) {
    void window.loadURL(`http://127.0.0.1:${config.backendPort}`)
    return
  }

  void window.loadURL(`${config.desktopScheme}://app/index.html`)
}

export function createMainWindow(host: CreateWindowHost): BrowserWindow {
  const { config } = host
  const window = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...getIconOption(host),
    title: config.displayName,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: Path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  attachContextMenu(window)
  attachWindowOpenHandler(window)

  let surfaced = false
  const surfaceWindow = (): void => {
    if (surfaced || window.isDestroyed()) return
    surfaced = true
    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    }
    if (!window.isVisible()) {
      window.show()
    }
    if (!window.isFocused()) {
      window.focus()
    }
  }

  window.on('page-title-updated', event => {
    event.preventDefault()
    window.setTitle(config.displayName)
  })
  window.webContents.on('did-finish-load', () => {
    if (!appContentRequestedWindows.has(window)) {
      return
    }
    window.setTitle(config.displayName)
    host.notifyDidFinishLoad()
    surfaceWindow()
  })
  window.once('ready-to-show', () => {
    surfaceWindow()
  })

  if (config.deferInitialLoad) {
    surfaceWindow()
  } else {
    loadMainWindowContent(window, config)
  }

  window.on('closed', () => {
    if (host.isMainWindow(window)) {
      host.setMainWindow(null)
    }
  })

  return window
}
