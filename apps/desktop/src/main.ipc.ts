import { BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type {
  ContextMenuItem,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
} from '@orxa-code/contracts'

import { showDesktopConfirmDialog } from './confirmDialog'
import { getSafeExternalUrl, getSafeTheme } from './main.logging'
import { getDestructiveMenuIcon } from './main.menu'

export interface IpcChannels {
  readonly getWsUrl: string
  readonly pickFolder: string
  readonly confirm: string
  readonly setTheme: string
  readonly contextMenu: string
  readonly openExternal: string
  readonly updateGetState: string
  readonly updateDownload: string
  readonly updateInstall: string
  readonly updateCheck: string
}

export interface IpcUpdaterAdapter {
  getState(): DesktopUpdateState
  downloadAvailable(): Promise<{ accepted: boolean; completed: boolean }>
  installDownloaded(): Promise<{ accepted: boolean; completed: boolean }>
  isUpdaterConfigured(): boolean
  checkForUpdates(reason: string): Promise<boolean>
}

export interface IpcHost {
  readonly channels: IpcChannels
  readonly backendWsUrl: () => string
  readonly mainWindow: () => BrowserWindow | null
  readonly isQuitting: () => boolean
  readonly updater: IpcUpdaterAdapter
}

export async function pickFolderForDesktop(host: IpcHost): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? host.mainWindow()
  const result = owner
    ? await dialog.showOpenDialog(owner, {
        properties: ['openDirectory', 'createDirectory'],
      })
    : await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}

interface NormalizedContextMenuItem {
  id: string
  label: string
  destructive: boolean
  disabled: boolean
}

export function normalizeContextMenuItems(items: ContextMenuItem[]): NormalizedContextMenuItem[] {
  return items
    .filter(item => typeof item.id === 'string' && typeof item.label === 'string')
    .map(item => ({
      id: item.id,
      label: item.label,
      destructive: item.destructive === true,
      disabled: item.disabled === true,
    }))
}

export function resolveContextMenuPosition(position?: {
  x: number
  y: number
}): { x: number; y: number } | null {
  return position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= 0 &&
    position.y >= 0
    ? { x: Math.floor(position.x), y: Math.floor(position.y) }
    : null
}

export function buildContextMenuTemplate(
  items: ReadonlyArray<NormalizedContextMenuItem>,
  resolve: (value: string | null) => void
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  let hasInsertedDestructiveSeparator = false

  for (const item of items) {
    if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
      template.push({ type: 'separator' })
      hasInsertedDestructiveSeparator = true
    }
    const itemOption: MenuItemConstructorOptions = {
      label: item.label,
      enabled: !item.disabled,
      click: () => resolve(item.id),
    }
    if (item.destructive) {
      const destructiveIcon = getDestructiveMenuIcon()
      if (destructiveIcon) {
        itemOption.icon = destructiveIcon
      }
    }
    template.push(itemOption)
  }

  return template
}

function createUpdateActionResult(
  host: IpcHost,
  result: { accepted: boolean; completed: boolean }
): DesktopUpdateActionResult {
  return {
    accepted: result.accepted,
    completed: result.completed,
    state: host.updater.getState(),
  } satisfies DesktopUpdateActionResult
}

function createUpdateCheckResult(host: IpcHost, checked: boolean): DesktopUpdateCheckResult {
  return {
    checked,
    state: host.updater.getState(),
  } satisfies DesktopUpdateCheckResult
}

export function registerDesktopUpdateIpcHandlers(host: IpcHost): void {
  const { channels } = host
  ipcMain.removeHandler(channels.updateGetState)
  ipcMain.handle(channels.updateGetState, async () => host.updater.getState())

  ipcMain.removeHandler(channels.updateDownload)
  ipcMain.handle(channels.updateDownload, async () =>
    createUpdateActionResult(host, await host.updater.downloadAvailable())
  )

  ipcMain.removeHandler(channels.updateInstall)
  ipcMain.handle(channels.updateInstall, async () => {
    if (host.isQuitting()) {
      return createUpdateActionResult(host, { accepted: false, completed: false })
    }
    return createUpdateActionResult(host, await host.updater.installDownloaded())
  })

  ipcMain.removeHandler(channels.updateCheck)
  ipcMain.handle(channels.updateCheck, async () =>
    host.updater.isUpdaterConfigured()
      ? createUpdateCheckResult(host, await host.updater.checkForUpdates('web-ui'))
      : createUpdateCheckResult(host, false)
  )
}

function registerCoreIpcHandlers(host: IpcHost): void {
  const { channels } = host
  ipcMain.removeAllListeners(channels.getWsUrl)
  ipcMain.on(channels.getWsUrl, event => {
    event.returnValue = host.backendWsUrl()
  })

  ipcMain.removeHandler(channels.pickFolder)
  ipcMain.handle(channels.pickFolder, () => pickFolderForDesktop(host))

  ipcMain.removeHandler(channels.confirm)
  ipcMain.handle(channels.confirm, async (_event, message: unknown) => {
    if (typeof message !== 'string') {
      return false
    }
    const owner = BrowserWindow.getFocusedWindow() ?? host.mainWindow()
    return showDesktopConfirmDialog(message, owner)
  })

  ipcMain.removeHandler(channels.setTheme)
  ipcMain.handle(channels.setTheme, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme)
    if (!theme) {
      return
    }
    nativeTheme.themeSource = theme
  })
}

function registerContextMenuHandler(host: IpcHost): void {
  const { channels } = host
  ipcMain.removeHandler(channels.contextMenu)
  ipcMain.handle(
    channels.contextMenu,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalizedItems = normalizeContextMenuItems(items)
      if (normalizedItems.length === 0) {
        return null
      }
      const popupPosition = resolveContextMenuPosition(position)
      const window = BrowserWindow.getFocusedWindow() ?? host.mainWindow()
      if (!window) return null
      return new Promise<string | null>(resolve => {
        const menu = Menu.buildFromTemplate(buildContextMenuTemplate(normalizedItems, resolve))
        menu.popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        })
      })
    }
  )
}

function registerOpenExternalHandler(host: IpcHost): void {
  const { channels } = host
  ipcMain.removeHandler(channels.openExternal)
  ipcMain.handle(channels.openExternal, async (_event, rawUrl: unknown) => {
    const externalUrl = getSafeExternalUrl(rawUrl)
    if (!externalUrl) {
      return false
    }
    try {
      await shell.openExternal(externalUrl)
      return true
    } catch {
      return false
    }
  })
}

export function registerIpcHandlers(host: IpcHost): void {
  registerCoreIpcHandlers(host)
  registerContextMenuHandler(host)
  registerOpenExternalHandler(host)
  registerDesktopUpdateIpcHandlers(host)
}
