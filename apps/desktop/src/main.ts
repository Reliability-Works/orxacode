import * as Crypto from 'node:crypto'
import * as FS from 'node:fs'
import * as OS from 'node:os'
import * as Path from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import * as Effect from 'effect/Effect'
import { NetService } from '@orxa-code/shared/Net'
import {
  configureAppIdentity as configureAppIdentityImpl,
  resolveUserDataPath,
} from './main.identity'
import {
  createDesktopLoggingState,
  initializePackagedLogging as initializePackagedLoggingImpl,
  writeDesktopLogHeader as writeDesktopLogHeaderImpl,
} from './main.logging'
import { syncShellEnvironment } from './syncShellEnvironment'
import { createUpdaterController } from './main.updater'
import { checkForDesktopUpdatesFromMenu, handleDesktopFatalStartupError } from './main.runtimeUi'
import { registerDesktopFileProtocol } from './main.protocol'
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
import { createMainWindow, loadMainWindowContent, type CreateWindowHost } from './main.window'
import { createDesktopWindowHost, resolveDesktopIconPath } from './main.windowHost'
import { resolveDesktopRuntimeInfo } from './runtimeArch'
import { createDesktopRemoteAccessPreferencesStore } from './remoteAccessPreferences'
import { applyRemoteAccessPreferences as applyRemoteAccessPreferencesImpl } from './remoteAccessRuntime'
import { resolveRemoteAccessRuntimeState } from './remoteAccessRuntimeState'
import { waitForBackendReady } from './backendReady'
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
let backendReadyForWindowContent = false
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
function registerDesktopProtocol(): void {
  registerDesktopFileProtocol({
    isDevelopment,
    alreadyRegistered: desktopProtocolRegistered,
    desktopScheme: DESKTOP_SCHEME,
    resolveDesktopStaticDir,
    resolveDesktopStaticPath,
    markRegistered: () => {
      desktopProtocolRegistered = true
    },
  })
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
  await checkForDesktopUpdatesFromMenu({
    checkForUpdates: source => updaterController.checkForUpdates(source),
    getState: () => updaterController.getState(),
  })
}
function configureApplicationMenu(): void {
  configureApplicationMenuImpl(menuHost)
}
function configureAppIdentity(): void {
  configureAppIdentityImpl({
    app,
    appDisplayName: APP_DISPLAY_NAME,
    appUserModelId: APP_USER_MODEL_ID,
    commitHash: resolveAboutCommitHash(),
    legacyUserDataDirName: LEGACY_USER_DATA_DIR_NAME,
    linuxDesktopEntryName: LINUX_DESKTOP_ENTRY_NAME,
    resolveIconPath: ext => resolveDesktopIconPath(ROOT_DIR, ext),
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
function refreshRemoteAccessRuntimeState(): void {
  const { environmentId, bootstrapToken } = resolveRemoteAccessRuntimeState({
    store: remoteAccessPreferencesStore,
    previousBootstrapToken: remoteAccessBootstrapToken,
  })
  remoteAccessEnvironmentId = environmentId
  remoteAccessBootstrapToken = bootstrapToken
}
const remoteAccessRuntimeHost = {
  store: remoteAccessPreferencesStore,
  writeLog: writeDesktopLogHeader,
  restartBackend: async () => {
    refreshRemoteAccessRuntimeState()
    await stopBackendAndWaitForExit()
    if (!isQuitting) {
      startBackend()
      await waitForBackendReady({ log: writeDesktopLogHeader, port: backendPort })
    }
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
const createWindowHost: CreateWindowHost = createDesktopWindowHost({
  displayName: APP_DISPLAY_NAME,
  desktopScheme: DESKTOP_SCHEME,
  isDevelopment,
  getBackendPort: () => backendPort || null,
  shouldDeferInitialLoad: () => !isDevelopment && !backendReadyForWindowContent,
  resolveIconPath: ext => resolveDesktopIconPath(ROOT_DIR, ext),
  notifyDidFinishLoad: () => {
    updaterController.setState({})
  },
  setMainWindow: window => {
    mainWindow = window
  },
  isMainWindow: window => mainWindow === window,
})

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
async function bootstrap(): Promise<void> {
  writeDesktopLogHeader('bootstrap start')
  backendPort = await Effect.service(NetService).pipe(
    Effect.flatMap(net => net.reserveLoopbackPort()),
    Effect.provide(NetService.layer),
    Effect.runPromise
  )
  writeDesktopLogHeader(`reserved backend port via NetService port=${backendPort}`)
  backendAuthToken = Crypto.randomBytes(24).toString('hex')
  refreshRemoteAccessRuntimeState()
  backendReadyForWindowContent = false
  const baseUrl = `ws://127.0.0.1:${backendPort}`
  writeDesktopLogHeader(`bootstrap resolved websocket endpoint baseUrl=${baseUrl}`)
  registerIpcHandlers()
  writeDesktopLogHeader('bootstrap ipc handlers registered')
  mainWindow = createWindow()
  writeDesktopLogHeader('bootstrap main window created')
  startBackend()
  writeDesktopLogHeader('bootstrap backend start requested')
  await waitForBackendReady({ log: writeDesktopLogHeader, port: backendPort })
  backendReadyForWindowContent = true
  if (mainWindow && !mainWindow.isDestroyed() && !isDevelopment) {
    loadMainWindowContent(mainWindow, createWindowHost.config)
    writeDesktopLogHeader('bootstrap main window content load requested')
  }
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
        handleDesktopFatalStartupError({
          stage: 'smoke-test',
          error,
          isQuitting,
          setQuitting: value => {
            isQuitting = value
          },
          writeLog: writeDesktopLogHeader,
          stopBackend,
          restoreLogging: () => {
            loggingState.restoreStdIoCapture?.()
          },
        })
      })
      return
    }
    configureApplicationMenu()
    registerDesktopProtocol()
    updaterController.configure()
    void bootstrap().catch(error => {
      handleDesktopFatalStartupError({
        stage: 'bootstrap',
        error,
        isQuitting,
        setQuitting: value => {
          isQuitting = value
        },
        writeLog: writeDesktopLogHeader,
        stopBackend,
        restoreLogging: () => {
          loggingState.restoreStdIoCapture?.()
        },
      })
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })
  })
  .catch(error => {
    handleDesktopFatalStartupError({
      stage: 'whenReady',
      error,
      isQuitting,
      setQuitting: value => {
        isQuitting = value
      },
      writeLog: writeDesktopLogHeader,
      stopBackend,
      restoreLogging: () => {
        loggingState.restoreStdIoCapture?.()
      },
    })
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
