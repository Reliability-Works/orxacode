import type { MenuItemConstructorOptions } from 'electron'

type AppCommandCallbacks = {
  onOpenSettings: () => void
  onToggleWorkspaceSidebar: () => void
  onToggleOperationsSidebar: () => void
  onToggleBrowserSidebar: () => void
}

type BuildApplicationMenuTemplateInput = {
  appName: string
  platform: NodeJS.Platform
  onCheckForUpdates: () => void
} & AppCommandCallbacks

function buildMacAppMenu(
  appName: string,
  callbacks: AppCommandCallbacks
): MenuItemConstructorOptions {
  return {
    label: appName || 'Orxa Code',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Command+,', click: callbacks.onOpenSettings },
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

function buildViewMenu(callbacks: AppCommandCallbacks): MenuItemConstructorOptions {
  return {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Toggle Workspace Sidebar', click: callbacks.onToggleWorkspaceSidebar },
      { label: 'Toggle Operations Sidebar', click: callbacks.onToggleOperationsSidebar },
      { label: 'Toggle Browser Sidebar', click: callbacks.onToggleBrowserSidebar },
    ],
  }
}

export function buildApplicationMenuTemplate(
  input: BuildApplicationMenuTemplateInput
): MenuItemConstructorOptions[] {
  const viewMenu = buildViewMenu(input)
  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Check for updates',
        click: input.onCheckForUpdates,
      },
    ],
  }

  if (input.platform === 'darwin') {
    return [
      buildMacAppMenu(input.appName, input),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      viewMenu,
      { role: 'windowMenu' },
      helpMenu,
    ]
  }

  return [{ role: 'fileMenu' }, viewMenu, { role: 'windowMenu' }, helpMenu]
}
