import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBrowserBounds, DesktopBridge } from '@orxa-code/contracts'

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

const PICK_FOLDER_CHANNEL = 'desktop:pick-folder'
const CONFIRM_CHANNEL = 'desktop:confirm'
const SET_THEME_CHANNEL = 'desktop:set-theme'
const CONTEXT_MENU_CHANNEL = 'desktop:context-menu'
const OPEN_EXTERNAL_CHANNEL = 'desktop:open-external'
const MENU_ACTION_CHANNEL = 'desktop:menu-action'
const UPDATE_STATE_CHANNEL = 'desktop:update-state'
const UPDATE_GET_STATE_CHANNEL = 'desktop:update-get-state'
const UPDATE_GET_PREFERENCES_CHANNEL = 'desktop:update-get-preferences'
const UPDATE_CHECK_CHANNEL = 'desktop:update-check'
const UPDATE_DOWNLOAD_CHANNEL = 'desktop:update-download'
const UPDATE_INSTALL_CHANNEL = 'desktop:update-install'
const UPDATE_SET_PREFERENCES_CHANNEL = 'desktop:update-set-preferences'
const GET_WS_URL_CHANNEL = 'desktop:get-ws-url'
const SET_REMOTE_ACCESS_PREFERENCES_CHANNEL = 'desktop:set-remote-access-preferences'
const GET_REMOTE_ACCESS_SNAPSHOT_CHANNEL = 'desktop:get-remote-access-snapshot'

const browserApi = {
  getState: () => ipcRenderer.invoke(BROWSER_GET_STATE_CHANNEL),
  navigate: (url: string) => ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, url),
  back: () => ipcRenderer.invoke(BROWSER_BACK_CHANNEL),
  forward: () => ipcRenderer.invoke(BROWSER_FORWARD_CHANNEL),
  reload: () => ipcRenderer.invoke(BROWSER_RELOAD_CHANNEL),
  openTab: (url?: string) => ipcRenderer.invoke(BROWSER_OPEN_TAB_CHANNEL, url),
  closeTab: (tabId: string) => ipcRenderer.invoke(BROWSER_CLOSE_TAB_CHANNEL, tabId),
  switchTab: (tabId: string) => ipcRenderer.invoke(BROWSER_SWITCH_TAB_CHANNEL, tabId),
  setBounds: (bounds: DesktopBrowserBounds) =>
    ipcRenderer.invoke(BROWSER_SET_BOUNDS_CHANNEL, bounds),
  enableInspect: () => ipcRenderer.invoke(BROWSER_ENABLE_INSPECT_CHANNEL),
  disableInspect: () => ipcRenderer.invoke(BROWSER_DISABLE_INSPECT_CHANNEL),
  pollInspectAnnotation: () => ipcRenderer.invoke(BROWSER_POLL_INSPECT_ANNOTATION_CHANNEL),
  inspectAtPoint: (point: { x: number; y: number }) =>
    ipcRenderer.invoke(BROWSER_INSPECT_AT_POINT_CHANNEL, point),
}

contextBridge.exposeInMainWorld('desktopBridge', {
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL)
    return typeof result === 'string' ? result : null
  },
  setRemoteAccessPreferences: input =>
    ipcRenderer.invoke(SET_REMOTE_ACCESS_PREFERENCES_CHANNEL, input),
  getRemoteAccessSnapshot: () => ipcRenderer.invoke(GET_REMOTE_ACCESS_SNAPSHOT_CHANNEL),
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: message => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: theme => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: listener => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== 'string') return
      listener(action)
    }

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener)
    }
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  getUpdatePreferences: () => ipcRenderer.invoke(UPDATE_GET_PREFERENCES_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  setUpdatePreferences: input => ipcRenderer.invoke(UPDATE_SET_PREFERENCES_CHANNEL, input),
  onUpdateState: listener => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== 'object' || state === null) return
      listener(state as Parameters<typeof listener>[0])
    }

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener)
    }
  },
  browser: browserApi,
} satisfies DesktopBridge)
