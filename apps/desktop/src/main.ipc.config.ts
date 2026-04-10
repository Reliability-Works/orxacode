import type { IpcChannels } from './main.ipc'

export const PICK_FOLDER_CHANNEL = 'desktop:pick-folder'
export const CONFIRM_CHANNEL = 'desktop:confirm'
export const SET_THEME_CHANNEL = 'desktop:set-theme'
export const CONTEXT_MENU_CHANNEL = 'desktop:context-menu'
export const OPEN_EXTERNAL_CHANNEL = 'desktop:open-external'
export const MENU_ACTION_CHANNEL = 'desktop:menu-action'
export const UPDATE_STATE_CHANNEL = 'desktop:update-state'
export const UPDATE_GET_STATE_CHANNEL = 'desktop:update-get-state'
export const UPDATE_GET_PREFERENCES_CHANNEL = 'desktop:update-get-preferences'
export const UPDATE_DOWNLOAD_CHANNEL = 'desktop:update-download'
export const UPDATE_INSTALL_CHANNEL = 'desktop:update-install'
export const UPDATE_CHECK_CHANNEL = 'desktop:update-check'
export const UPDATE_SET_PREFERENCES_CHANNEL = 'desktop:update-set-preferences'
export const GET_WS_URL_CHANNEL = 'desktop:get-ws-url'
export const SET_REMOTE_ACCESS_PREFERENCES_CHANNEL = 'desktop:set-remote-access-preferences'
export const GET_REMOTE_ACCESS_SNAPSHOT_CHANNEL = 'desktop:get-remote-access-snapshot'

export const IPC_CHANNELS: IpcChannels = {
  getWsUrl: GET_WS_URL_CHANNEL,
  setRemoteAccessPreferences: SET_REMOTE_ACCESS_PREFERENCES_CHANNEL,
  getRemoteAccessSnapshot: GET_REMOTE_ACCESS_SNAPSHOT_CHANNEL,
  pickFolder: PICK_FOLDER_CHANNEL,
  confirm: CONFIRM_CHANNEL,
  setTheme: SET_THEME_CHANNEL,
  contextMenu: CONTEXT_MENU_CHANNEL,
  openExternal: OPEN_EXTERNAL_CHANNEL,
  updateGetState: UPDATE_GET_STATE_CHANNEL,
  updateGetPreferences: UPDATE_GET_PREFERENCES_CHANNEL,
  updateDownload: UPDATE_DOWNLOAD_CHANNEL,
  updateInstall: UPDATE_INSTALL_CHANNEL,
  updateCheck: UPDATE_CHECK_CHANNEL,
  updateSetPreferences: UPDATE_SET_PREFERENCES_CHANNEL,
}
