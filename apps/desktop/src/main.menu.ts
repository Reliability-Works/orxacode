import { app, BrowserWindow, dialog, Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { getAutoUpdateDisabledReason } from './updateState'

export interface MenuHost {
  readonly menuActionChannel: string
  readonly disabledByEnv: boolean
  readonly isDevelopment: boolean
  getMainWindow(): BrowserWindow | null
  setMainWindow(window: BrowserWindow): void
  createWindow(): BrowserWindow
  checkForUpdatesFromMenu(): Promise<void>
}

let destructiveMenuIconCache: Electron.NativeImage | null | undefined

export function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== 'darwin') return undefined
  if (destructiveMenuIconCache !== undefined) {
    return destructiveMenuIconCache ?? undefined
  }
  try {
    const icon = nativeImage.createFromNamedImage('trash').resize({
      width: 14,
      height: 14,
    })
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null
      return undefined
    }
    icon.setTemplateImage(true)
    destructiveMenuIconCache = icon
    return icon
  } catch {
    destructiveMenuIconCache = null
    return undefined
  }
}

export function dispatchMenuAction(host: MenuHost, action: string): void {
  const existingWindow =
    BrowserWindow.getFocusedWindow() ?? host.getMainWindow() ?? BrowserWindow.getAllWindows()[0]
  const targetWindow = existingWindow ?? host.createWindow()
  if (!existingWindow) {
    host.setMainWindow(targetWindow)
  }

  const send = (): void => {
    if (targetWindow.isDestroyed()) return
    targetWindow.webContents.send(host.menuActionChannel, action)
    if (!targetWindow.isVisible()) {
      targetWindow.show()
    }
    targetWindow.focus()
  }

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once('did-finish-load', send)
    return
  }

  send()
}

export function handleCheckForUpdatesMenuClick(host: MenuHost): void {
  const disabledReason = getAutoUpdateDisabledReason({
    isDevelopment: host.isDevelopment,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    disabledByEnv: host.disabledByEnv,
  })
  if (disabledReason) {
    console.info('[desktop-updater] Manual update check requested, but updates are disabled.')
    void dialog.showMessageBox({
      type: 'info',
      title: 'Updates unavailable',
      message: 'Automatic updates are not available right now.',
      detail: disabledReason,
      buttons: ['OK'],
    })
    return
  }
  if (!BrowserWindow.getAllWindows().length) {
    host.setMainWindow(host.createWindow())
  }
  void host.checkForUpdatesFromMenu()
}

function buildDarwinAppMenu(host: MenuHost): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      { label: 'Check for Updates...', click: () => handleCheckForUpdatesMenuClick(host) },
      { type: 'separator' },
      {
        label: 'Settings...',
        accelerator: 'CmdOrCtrl+,',
        click: () => dispatchMenuAction(host, 'open-settings'),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
}

function buildFileMenu(host: MenuHost): MenuItemConstructorOptions {
  return {
    label: 'File',
    submenu: [
      ...(process.platform === 'darwin'
        ? []
        : [
            {
              label: 'Settings...',
              accelerator: 'CmdOrCtrl+,',
              click: () => dispatchMenuAction(host, 'open-settings'),
            },
            { type: 'separator' as const },
          ]),
      { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ],
  }
}

function buildViewMenu(): MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus', visible: false },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
}

function buildHelpMenu(host: MenuHost): MenuItemConstructorOptions {
  return {
    role: 'help',
    submenu: [{ label: 'Check for Updates...', click: () => handleCheckForUpdatesMenuClick(host) }],
  }
}

export function configureApplicationMenu(host: MenuHost): void {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push(buildDarwinAppMenu(host))
  }
  template.push(
    buildFileMenu(host),
    { role: 'editMenu' },
    buildViewMenu(),
    { role: 'windowMenu' },
    buildHelpMenu(host)
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
