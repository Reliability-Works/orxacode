import * as Crypto from 'node:crypto'
import * as FS from 'node:fs'
import * as OS from 'node:os'
import * as Path from 'node:path'
import { app, BrowserWindow, dialog, protocol } from 'electron'
import * as Effect from 'effect/Effect'
import { NetService } from '@orxa-code/shared/Net'
import {
  configureAppIdentity as configureAppIdentityImpl,
  resolveResourcePath,
  resolveUserDataPath,
} from './main.identity'
import {
  createDesktopLoggingState,
  formatErrorMessage,
  initializePackagedLogging as initializePackagedLoggingImpl,
  writeDesktopLogHeader as writeDesktopLogHeaderImpl,
} from './main.logging'
import { syncShellEnvironment } from './syncShellEnvironment'
import { createUpdaterController } from './main.updater'
import {
  configureApplicationMenu as configureApplicationMenuImpl,
  type MenuHost,
} from './main.menu'
import { resolveDesktopRemoteAccessSnapshot } from './desktopRemoteAccessSnapshot'
import { createLocalEnvironmentBootstrap } from './localEnvironmentBootstrap'
import { registerIpcHandlers as registerIpcHandlersImpl, type IpcHost } from './main.ipc'
import { IPC_CHANNELS, MENU_ACTION_CHANNEL, UPDATE_STATE_CHANNEL } from './main.ipc.config'
import { createBackendController, type BackendHost } from './main.backend'
import { runSmokeTest } from './main.smoke'
import { createMainWindow, type CreateWindowHost } from './main.window'
import { resolveDesktopRuntimeInfo } from './runtimeArch'
import { createDesktopRemoteAccessPreferencesStore } from './remoteAccessPreferences'
import { applyRemoteAccessPreferences as applyRemoteAccessPreferencesImpl } from './remoteAccessRuntime'
import {
  createDesktopUpdatePreferencesStore,
  resolveDesktopUpdateFeedChannel,
} from './updatePreferences'
const isSmokeTest = process.argv.includes('--smoke-test') || process.env.ORXA_SMOKE_TEST === '1'
if (!isSmokeTest) {
  syncShellEnvironment()
}
const BASE_DIR = process.env.ORXA_HOME?.trim() || Path.join(OS.homedir(), '.orxa')
const STATE_DIR = Path.join(BASE_DIR, 'userdata')
const DESKTOP_SCHEME = 'orxa'
const ROOT_DIR = Path.resolve(__dirname, '../../..')
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const APP_DISPLAY_NAME = 'Orxa Code (Beta)'
const APP_USER_MODEL_ID = 'com.orxa.code'
const LINUX_DESKTOP_ENTRY_NAME = isDevelopment ? 'orxa-code-dev.desktop' : 'orxa-code.desktop'
const LINUX_WM_CLASS = isDevelopment ? 'orxa-code-dev' : 'orxa-code'
const USER_DATA_DIR_NAME = isDevelopment ? 'orxa-code-dev' : 'orxa-code'
const LEGACY_USER_DATA_DIR_NAME = isDevelopment ? 'Orxa Code (Dev)' : 'Orxa Code (Alpha)'
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i
const COMMIT_HASH_DISPLAY_LENGTH = 12
const LOG_DIR = Path.join(STATE_DIR, 'logs')
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024
const LOG_FILE_MAX_FILES = 10
const APP_RUN_ID = Crypto.randomBytes(6).toString('hex')
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000
const AUTO_UPDATE_DISABLED_BY_ENV = process.env.ORXA_CODE_DISABLE_AUTO_UPDATE === '1'

let mainWindow: BrowserWindow | null = null
let backendPort = 0
let backendAuthToken = ''
let remoteAccessBootstrapToken: string | undefined
let remoteAccessEnvironmentId: string | undefined
let isQuitting = false
let desktopProtocolRegistered = false
let aboutCommitHashCache: string | null | undefined
const loggingState = createDesktopLoggingState()
const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  runningUnderArm64Translation: app.runningUnderARM64Translation === true,
})
const updatePreferencesStore = createDesktopUpdatePreferencesStore(
  Path.join(STATE_DIR, 'update-preferences.json')
)
const remoteAccessPreferencesStore = createDesktopRemoteAccessPreferencesStore(
  Path.join(STATE_DIR, 'remote-access-preferences.json')
)
const initialUpdatePreferences = updatePreferencesStore.syncInstalledVersion(app.getVersion())
const updaterController = createUpdaterController(
  {
    channel: resolveDesktopUpdateFeedChannel(initialUpdatePreferences.releaseChannel),
    allowPrerelease: initialUpdatePreferences.releaseChannel === 'prerelease',
    startupDelayMs: AUTO_UPDATE_STARTUP_DELAY_MS,
    pollIntervalMs: AUTO_UPDATE_POLL_INTERVAL_MS,
    disabledByEnv: AUTO_UPDATE_DISABLED_BY_ENV,
    isDevelopment,
    updateStateChannel: UPDATE_STATE_CHANNEL,
    runtimeInfo: desktopRuntimeInfo,
  },
  {
    isQuitting: () => isQuitting,
    setQuitting: value => {
      isQuitting = value
    },
    stopBackendAndWaitForExit: () => stopBackendAndWaitForExit(),
  }
)
function writeDesktopLogHeader(message: string): void {
  writeDesktopLogHeaderImpl(loggingState, APP_RUN_ID, message)
}
initializePackagedLoggingImpl(loggingState, {
  logDir: LOG_DIR,
  logFileMaxBytes: LOG_FILE_MAX_BYTES,
  logFileMaxFiles: LOG_FILE_MAX_FILES,
  appRunId: APP_RUN_ID,
})

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', LINUX_WM_CLASS)
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function resolveAppRoot(): string {
  if (!app.isPackaged) {
    return ROOT_DIR
  }
  return app.getAppPath()
}
function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!COMMIT_HASH_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase()
}

function resolveEmbeddedCommitHash(): string | null {
  const packageJsonPath = Path.join(resolveAppRoot(), 'package.json')
  if (!FS.existsSync(packageJsonPath)) {
    return null
  }

  try {
    const raw = FS.readFileSync(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { orxaCommitHash?: unknown }
    return normalizeCommitHash(parsed.orxaCommitHash)
  } catch {
    return null
  }
}
function resolveAboutCommitHash(): string | null {
  if (aboutCommitHashCache !== undefined) {
    return aboutCommitHashCache
  }

  const envCommitHash = normalizeCommitHash(process.env.ORXA_COMMIT_HASH)
  if (envCommitHash) {
    aboutCommitHashCache = envCommitHash
    return aboutCommitHashCache
  }

  // Only packaged builds are required to expose commit metadata.
  if (!app.isPackaged) {
    aboutCommitHashCache = null
    return aboutCommitHashCache
  }

  aboutCommitHashCache = resolveEmbeddedCommitHash()
  return aboutCommitHashCache
}
function resolveBackendEntry(): string {
  return Path.join(resolveAppRoot(), 'apps/server/dist/bin.mjs')
}
function resolveBackendCwd(): string {
  if (!app.isPackaged) {
    return resolveAppRoot()
  }
  return OS.homedir()
}
function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot()
  const candidates = [
    Path.join(appRoot, 'apps/server/dist/client'),
    Path.join(appRoot, 'apps/web/dist'),
  ]

  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, 'index.html'))) {
      return candidate
    }
  }
  return null
}
function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl)
  const rawPath = decodeURIComponent(url.pathname)
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, '')
  if (normalizedPath.includes('..')) {
    return Path.join(staticRoot, 'index.html')
  }

  const requestedPath = normalizedPath.length > 0 ? normalizedPath : 'index.html'
  const resolvedPath = Path.join(staticRoot, requestedPath)

  if (Path.extname(resolvedPath)) {
    return resolvedPath
  }

  const nestedIndex = Path.join(resolvedPath, 'index.html')
  if (FS.existsSync(nestedIndex)) {
    return nestedIndex
  }

  return Path.join(staticRoot, 'index.html')
}
function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl)
    return Path.extname(url.pathname).length > 0
  } catch {
    return false
  }
}

function handleFatalStartupError(stage: string, error: unknown): void {
  const message = formatErrorMessage(error)
  const detail = error instanceof Error && typeof error.stack === 'string' ? `\n${error.stack}` : ''
  writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`)
  console.error(`[desktop] fatal startup error (${stage})`, error)
  if (!isQuitting) {
    isQuitting = true
    dialog.showErrorBox('Orxa Code failed to start', `Stage: ${stage}\n${message}${detail}`)
  }
  stopBackend()
  loggingState.restoreStdIoCapture?.()
  app.quit()
}
function registerDesktopProtocol(): void {
  if (isDevelopment || desktopProtocolRegistered) return

  const staticRoot = resolveDesktopStaticDir()
  if (!staticRoot) {
    throw new Error('Desktop static bundle missing. Build apps/server (with bundled client) first.')
  }

  const staticRootResolved = Path.resolve(staticRoot)
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`
  const fallbackIndex = Path.join(staticRootResolved, 'index.html')

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = resolveDesktopStaticPath(staticRootResolved, request.url)
      const resolvedCandidate = Path.resolve(candidate)
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix)
      const isAssetRequest = isStaticAssetRequest(request.url)

      if (!isInRoot || !FS.existsSync(resolvedCandidate)) {
        if (isAssetRequest) {
          callback({ error: -6 })
          return
        }
        callback({ path: fallbackIndex })
        return
      }

      callback({ path: resolvedCandidate })
    } catch {
      callback({ path: fallbackIndex })
    }
  })

  desktopProtocolRegistered = true
}
const menuHost: MenuHost = {
  menuActionChannel: MENU_ACTION_CHANNEL,
  disabledByEnv: AUTO_UPDATE_DISABLED_BY_ENV,
  isDevelopment,
  getMainWindow: () => mainWindow,
  setMainWindow: window => {
    mainWindow = window
  },
  createWindow: () => createWindow(),
  checkForUpdatesFromMenu: () => checkForUpdatesFromMenu(),
}
async function checkForUpdatesFromMenu(): Promise<void> {
  await updaterController.checkForUpdates('menu')
  const state = updaterController.getState()
  if (state.status === 'up-to-date') {
    void dialog.showMessageBox({
      type: 'info',
      title: "You're up to date!",
      message: `Orxa Code ${state.currentVersion} is currently the newest version available.`,
      buttons: ['OK'],
    })
  } else if (state.status === 'error') {
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: state.message ?? 'An unknown error occurred. Please try again later.',
      buttons: ['OK'],
    })
  }
}
function configureApplicationMenu(): void {
  configureApplicationMenuImpl(menuHost)
}
function resolveIconPath(ext: 'ico' | 'icns' | 'png'): string | null {
  return resolveResourcePath(ROOT_DIR, `icon.${ext}`)
}
function configureAppIdentity(): void {
  configureAppIdentityImpl({
    app,
    appDisplayName: APP_DISPLAY_NAME,
    appUserModelId: APP_USER_MODEL_ID,
    commitHash: resolveAboutCommitHash(),
    legacyUserDataDirName: LEGACY_USER_DATA_DIR_NAME,
    linuxDesktopEntryName: LINUX_DESKTOP_ENTRY_NAME,
    resolveIconPath,
  })
}
const backendHost: BackendHost = {
  config: { baseDir: BASE_DIR, appRunId: APP_RUN_ID },
  logging: loggingState,
  isQuitting: () => isQuitting,
  resolveBackendEntry: () => resolveBackendEntry(),
  resolveBackendCwd: () => resolveBackendCwd(),
  getBackendPort: () => backendPort,
  getBackendAuthToken: () => backendAuthToken,
  getRemoteAccessBootstrapToken: () => remoteAccessBootstrapToken,
  getRemoteAccessEnvironmentId: () => remoteAccessEnvironmentId,
}
const backendController = createBackendController(backendHost)
const startBackend = (): void => backendController.start()
const stopBackend = (): void => backendController.stop()
const stopBackendAndWaitForExit = (timeoutMs?: number): Promise<void> =>
  backendController.stopAndWaitForExit(timeoutMs)
const remoteAccessRuntimeHost = {
  store: remoteAccessPreferencesStore,
  writeLog: writeDesktopLogHeader,
  restartBackend: async () => {
    await stopBackendAndWaitForExit()
    if (!isQuitting) startBackend()
  },
}
const ipcHost: IpcHost = {
  channels: IPC_CHANNELS,
  getLocalEnvironmentBootstrap: async () => {
    const remoteAccessState = remoteAccessPreferencesStore.get()
    const environmentId =
      remoteAccessEnvironmentId ?? remoteAccessState.environmentId ?? 'local-desktop'
    return createLocalEnvironmentBootstrap({
      backendAuthToken,
      backendPort,
      environmentId,
    })
  },
  setRemoteAccessPreferences: input =>
    applyRemoteAccessPreferencesImpl(remoteAccessRuntimeHost, input),
  getRemoteAccessSnapshot: () =>
    resolveDesktopRemoteAccessSnapshot({
      backendPort,
      remoteAccessBootstrapToken,
      remoteAccessEnvironmentId,
      store: remoteAccessPreferencesStore,
    }),
  mainWindow: () => mainWindow,
  isQuitting: () => isQuitting,
  updater: updaterController,
  getUpdatePreferences: () => updatePreferencesStore.get(),
  setUpdatePreferences: input => {
    const next = updatePreferencesStore.set(input)
    updaterController.setChannel(resolveDesktopUpdateFeedChannel(next.releaseChannel))
    updaterController.setAllowPrerelease(next.releaseChannel === 'prerelease')
    return next
  },
}

function registerIpcHandlers(): void {
  registerIpcHandlersImpl(ipcHost)
}
const createWindowHost: CreateWindowHost = {
  get config() {
    return {
      displayName: APP_DISPLAY_NAME,
      desktopScheme: DESKTOP_SCHEME,
      isDevelopment,
      backendPort: backendPort || null,
    }
  },
  resolveIconPath: ext => resolveIconPath(ext),
  notifyDidFinishLoad: () => {
    updaterController.setState({})
  },
  setMainWindow: window => {
    mainWindow = window
  },
  isMainWindow: window => mainWindow === window,
}

function createWindow(): BrowserWindow {
  return createMainWindow(createWindowHost)
}

function quitFromSignal(signal: 'SIGINT' | 'SIGTERM'): void {
  if (isQuitting) return
  isQuitting = true
  writeDesktopLogHeader(`${signal} received`)
  updaterController.clearPollTimer()
  stopBackend()
  loggingState.restoreStdIoCapture?.()
  app.quit()
}
app.setPath(
  'userData',
  resolveUserDataPath({
    legacyUserDataDirName: LEGACY_USER_DATA_DIR_NAME,
    userDataDirName: USER_DATA_DIR_NAME,
  })
)
configureAppIdentity()
async function waitForBackendReady(port: number, maxWaitMs = 15_000): Promise<void> {
  const intervalMs = 200
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/.well-known/orxa/environment`)
      if (response.ok) {
        writeDesktopLogHeader(`backend ready after ${attempt + 1} attempts`)
        return
      }
    } catch {
      // Server not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  writeDesktopLogHeader(`backend readiness check timed out after ${maxWaitMs}ms, proceeding anyway`)
}

async function bootstrap(): Promise<void> {
  writeDesktopLogHeader('bootstrap start')
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap(net => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise
  )
  writeDesktopLogHeader(`reserved backend port via NetService port=${backendPort}`)
  backendAuthToken = Crypto.randomBytes(24).toString('hex')
  const remoteAccessState = remoteAccessPreferencesStore.get()
  remoteAccessEnvironmentId = remoteAccessState.environmentId
  remoteAccessBootstrapToken = remoteAccessState.enabled
    ? Crypto.randomBytes(24).toString('hex')
    : undefined
  const baseUrl = `ws://127.0.0.1:${backendPort}`
  writeDesktopLogHeader(`bootstrap resolved websocket endpoint baseUrl=${baseUrl}`)
  registerIpcHandlers()
  writeDesktopLogHeader('bootstrap ipc handlers registered')
  startBackend()
  writeDesktopLogHeader('bootstrap backend start requested')
  await waitForBackendReady(backendPort)
  mainWindow = createWindow()
  writeDesktopLogHeader('bootstrap main window created')
}

app.on('before-quit', () => {
  isQuitting = true
  updaterController.setInstallInFlight(false)
  writeDesktopLogHeader('before-quit received')
  updaterController.clearPollTimer()
  stopBackend()
  loggingState.restoreStdIoCapture?.()
})
app
  .whenReady()
  .then(() => {
    writeDesktopLogHeader('app ready')
    configureAppIdentity()
    if (isSmokeTest) {
      void runSmokeTest({
        writeLog: writeDesktopLogHeader,
        resolveDesktopStaticDir,
        resolveBackendEntry,
        resolvePackagedModule: request => require.resolve(request),
        isQuitting: () => isQuitting,
        setQuitting: value => {
          isQuitting = value
        },
      }).catch(error => {
        handleFatalStartupError('smoke-test', error)
      })
      return
    }
    configureApplicationMenu()
    registerDesktopProtocol()
    updaterController.configure()
    void bootstrap().catch(error => {
      handleFatalStartupError('bootstrap', error)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })
  })
  .catch(error => {
    handleFatalStartupError('whenReady', error)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuitting) {
    app.quit()
  }
})

if (process.platform !== 'win32') {
  process.on('SIGINT', () => quitFromSignal('SIGINT'))
  process.on('SIGTERM', () => quitFromSignal('SIGTERM'))
}
