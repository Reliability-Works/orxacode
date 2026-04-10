import { BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type {
  DesktopBrowserInspectPoint,
  DesktopBrowserBounds,
  ContextMenuItem,
  DesktopRemoteAccessSnapshot,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdatePreferences,
  DesktopUpdateState,
} from '@orxa-code/contracts'

import {
  BROWSER_BACK_CHANNEL,
  BROWSER_CLOSE_TAB_CHANNEL,
  BROWSER_DISABLE_INSPECT_CHANNEL,
  BROWSER_ENABLE_INSPECT_CHANNEL,
  BROWSER_FORWARD_CHANNEL,
  BROWSER_GET_STATE_CHANNEL,
  BROWSER_INSPECT_AT_POINT_CHANNEL,
  BROWSER_NAVIGATE_CHANNEL,
  BROWSER_OPEN_TAB_CHANNEL,
  BROWSER_POLL_INSPECT_ANNOTATION_CHANNEL,
  BROWSER_RELOAD_CHANNEL,
  BROWSER_SET_BOUNDS_CHANNEL,
  BROWSER_SWITCH_TAB_CHANNEL,
} from './browser.channels'
import { createBrowserRuntimeController } from './browserRuntime'
import { showDesktopConfirmDialog } from './confirmDialog'
import { getSafeExternalUrl, getSafeTheme } from './main.logging'
import { getDestructiveMenuIcon } from './main.menu'

export interface IpcChannels {
  readonly getWsUrl: string
  readonly getRemoteAccessSnapshot: string
  readonly pickFolder: string
  readonly confirm: string
  readonly setTheme: string
  readonly contextMenu: string
  readonly openExternal: string
  readonly updateGetState: string
  readonly updateGetPreferences: string
  readonly updateDownload: string
  readonly updateInstall: string
  readonly updateCheck: string
  readonly updateSetPreferences: string
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
  readonly getRemoteAccessSnapshot: () => DesktopRemoteAccessSnapshot
  readonly mainWindow: () => BrowserWindow | null
  readonly isQuitting: () => boolean
  readonly updater: IpcUpdaterAdapter
  readonly getUpdatePreferences: () => DesktopUpdatePreferences
  readonly setUpdatePreferences: (
    input: Partial<DesktopUpdatePreferences>
  ) => DesktopUpdatePreferences
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

  ipcMain.removeHandler(channels.updateGetPreferences)
  ipcMain.handle(channels.updateGetPreferences, async () => host.getUpdatePreferences())

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

  ipcMain.removeHandler(channels.updateSetPreferences)
  ipcMain.handle(channels.updateSetPreferences, async (_event, rawInput: unknown) => {
    const input =
      rawInput && typeof rawInput === 'object'
        ? (rawInput as Partial<DesktopUpdatePreferences>)
        : {}
    return host.setUpdatePreferences(input)
  })
}

function registerCoreIpcHandlers(host: IpcHost): void {
  const { channels } = host
  ipcMain.removeAllListeners(channels.getWsUrl)
  ipcMain.on(channels.getWsUrl, event => {
    event.returnValue = host.backendWsUrl()
  })

  ipcMain.removeHandler(channels.getRemoteAccessSnapshot)
  ipcMain.handle(channels.getRemoteAccessSnapshot, async () => host.getRemoteAccessSnapshot())

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

function normalizeBrowserBounds(raw: unknown): DesktopBrowserBounds | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const bounds = raw as Partial<DesktopBrowserBounds>
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null
  }
  const x = bounds.x as number
  const y = bounds.y as number
  const width = bounds.width as number
  const height = bounds.height as number
  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(0, Math.floor(width)),
    height: Math.max(0, Math.floor(height)),
  }
}

function normalizeInspectPoint(raw: unknown): DesktopBrowserInspectPoint | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const point = raw as Partial<DesktopBrowserInspectPoint>
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null
  }
  const x = point.x as number
  const y = point.y as number
  return {
    x: Math.floor(x),
    y: Math.floor(y),
  }
}

function registerBrowserRuntimeHandlers(host: IpcHost): void {
  const browserRuntime = createBrowserRuntimeController({
    mainWindow: () => host.mainWindow(),
  })

  ipcMain.removeHandler(BROWSER_GET_STATE_CHANNEL)
  ipcMain.handle(BROWSER_GET_STATE_CHANNEL, async () => browserRuntime.getState())

  ipcMain.removeHandler(BROWSER_NAVIGATE_CHANNEL)
  ipcMain.handle(BROWSER_NAVIGATE_CHANNEL, async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') {
      return browserRuntime.getState()
    }
    return browserRuntime.navigate(rawUrl)
  })

  ipcMain.removeHandler(BROWSER_BACK_CHANNEL)
  ipcMain.handle(BROWSER_BACK_CHANNEL, async () => browserRuntime.back())

  ipcMain.removeHandler(BROWSER_FORWARD_CHANNEL)
  ipcMain.handle(BROWSER_FORWARD_CHANNEL, async () => browserRuntime.forward())

  ipcMain.removeHandler(BROWSER_RELOAD_CHANNEL)
  ipcMain.handle(BROWSER_RELOAD_CHANNEL, async () => browserRuntime.reload())

  ipcMain.removeHandler(BROWSER_OPEN_TAB_CHANNEL)
  ipcMain.handle(BROWSER_OPEN_TAB_CHANNEL, async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') {
      return browserRuntime.openTab()
    }
    return browserRuntime.openTab(rawUrl)
  })

  ipcMain.removeHandler(BROWSER_CLOSE_TAB_CHANNEL)
  ipcMain.handle(BROWSER_CLOSE_TAB_CHANNEL, async (_event, rawTabId: unknown) => {
    if (typeof rawTabId !== 'string') {
      return browserRuntime.getState()
    }
    return browserRuntime.closeTab(rawTabId)
  })

  ipcMain.removeHandler(BROWSER_SWITCH_TAB_CHANNEL)
  ipcMain.handle(BROWSER_SWITCH_TAB_CHANNEL, async (_event, rawTabId: unknown) => {
    if (typeof rawTabId !== 'string') {
      return browserRuntime.getState()
    }
    return browserRuntime.switchTab(rawTabId)
  })

  ipcMain.removeHandler(BROWSER_SET_BOUNDS_CHANNEL)
  ipcMain.handle(BROWSER_SET_BOUNDS_CHANNEL, async (_event, rawBounds: unknown) => {
    const bounds = normalizeBrowserBounds(rawBounds)
    if (!bounds) {
      return browserRuntime.getState()
    }
    return browserRuntime.setBounds(bounds)
  })

  ipcMain.removeHandler(BROWSER_ENABLE_INSPECT_CHANNEL)
  ipcMain.handle(BROWSER_ENABLE_INSPECT_CHANNEL, async () => browserRuntime.enableInspect())

  ipcMain.removeHandler(BROWSER_DISABLE_INSPECT_CHANNEL)
  ipcMain.handle(BROWSER_DISABLE_INSPECT_CHANNEL, async () => browserRuntime.disableInspect())

  ipcMain.removeHandler(BROWSER_POLL_INSPECT_ANNOTATION_CHANNEL)
  ipcMain.handle(BROWSER_POLL_INSPECT_ANNOTATION_CHANNEL, async () =>
    browserRuntime.pollInspectAnnotation()
  )

  ipcMain.removeHandler(BROWSER_INSPECT_AT_POINT_CHANNEL)
  ipcMain.handle(BROWSER_INSPECT_AT_POINT_CHANNEL, async (_event, rawPoint: unknown) => {
    const point = normalizeInspectPoint(rawPoint)
    if (!point) {
      return null
    }
    return browserRuntime.inspectAtPoint(point)
  })
}

export function registerIpcHandlers(host: IpcHost): void {
  registerCoreIpcHandlers(host)
  registerContextMenuHandler(host)
  registerOpenExternalHandler(host)
  registerBrowserRuntimeHandlers(host)
  registerDesktopUpdateIpcHandlers(host)
}
