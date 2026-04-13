import * as FS from 'node:fs'
import * as OS from 'node:os'
import * as Path from 'node:path'

type LinuxDesktopNamedApp = Electron.App & {
  setDesktopName?: (desktopName: string) => void
}

export function resolveUserDataPath(input: {
  legacyUserDataDirName: string
  userDataDirName: string
}) {
  const appDataBase =
    process.platform === 'win32'
      ? process.env.APPDATA || Path.join(OS.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? Path.join(OS.homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || Path.join(OS.homedir(), '.config')

  const legacyPath = Path.join(appDataBase, input.legacyUserDataDirName)
  if (FS.existsSync(legacyPath)) {
    return legacyPath
  }

  return Path.join(appDataBase, input.userDataDirName)
}

export function resolveResourcePath(rootDir: string, fileName: string): string | null {
  const candidates = [
    Path.join(rootDir, 'build', fileName),
    Path.join(__dirname, '../resources', fileName),
    Path.join(__dirname, '../prod-resources', fileName),
    Path.join(process.resourcesPath, 'resources', fileName),
    Path.join(process.resourcesPath, fileName),
  ]

  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function configureAppIdentity(input: {
  app: Electron.App
  appDisplayName: string
  appUserModelId: string
  commitHash: string | null
  legacyUserDataDirName: string
  linuxDesktopEntryName: string
  resolveIconPath: (ext: 'ico' | 'icns' | 'png') => string | null
}) {
  input.app.setName(input.appDisplayName)
  input.app.setAboutPanelOptions({
    applicationName: input.appDisplayName,
    applicationVersion: input.app.getVersion(),
    version: input.commitHash ?? 'unknown',
  })

  if (process.platform === 'win32') {
    input.app.setAppUserModelId(input.appUserModelId)
  }

  if (process.platform === 'linux') {
    ;(input.app as LinuxDesktopNamedApp).setDesktopName?.(input.linuxDesktopEntryName)
  }

  if (process.platform === 'darwin' && input.app.dock) {
    const iconPath = input.resolveIconPath('png')
    if (iconPath) {
      input.app.dock.setIcon(iconPath)
    }
  }
}
