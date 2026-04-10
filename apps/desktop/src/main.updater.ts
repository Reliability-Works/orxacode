import * as FS from 'node:fs'
import { createRequire } from 'node:module'
import * as Path from 'node:path'

import { app, BrowserWindow } from 'electron'
import type { DesktopUpdateState } from '@orxa-code/contracts'

import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from './updateMachine'
import { getAutoUpdateDisabledReason, shouldBroadcastDownloadProgress } from './updateState'
import { isArm64HostRunningIntelBuild } from './runtimeArch'
import type { DesktopRuntimeInfo } from '@orxa-code/contracts'
import { formatErrorMessage } from './main.logging'

type DesktopUpdateErrorContext = DesktopUpdateState['errorContext']
type ElectronAutoUpdater = typeof import('electron-updater').autoUpdater

let cachedAutoUpdater: ElectronAutoUpdater | null | undefined
const nodeRequire = createRequire(import.meta.url)

function getAutoUpdater(): ElectronAutoUpdater | null {
  if (cachedAutoUpdater !== undefined) {
    return cachedAutoUpdater
  }

  try {
    cachedAutoUpdater = (nodeRequire('electron-updater') as typeof import('electron-updater'))
      .autoUpdater
  } catch (error) {
    cachedAutoUpdater = null
    console.error(`[desktop-updater] Failed to load electron-updater: ${formatErrorMessage(error)}`)
  }

  return cachedAutoUpdater
}

export interface UpdaterConfig {
  channel: string
  allowPrerelease: boolean
  readonly startupDelayMs: number
  readonly pollIntervalMs: number
  readonly disabledByEnv: boolean
  readonly isDevelopment: boolean
  readonly updateStateChannel: string
  readonly runtimeInfo: DesktopRuntimeInfo
}

export interface UpdaterHost {
  isQuitting: () => boolean
  setQuitting: (value: boolean) => void
  stopBackendAndWaitForExit: () => Promise<void>
}

export interface UpdaterController {
  configure(): void
  clearPollTimer(): void
  getState(): DesktopUpdateState
  setState(patch: Partial<DesktopUpdateState>): void
  setAllowPrerelease(value: boolean): void
  setChannel(value: string): void
  checkForUpdates(reason: string): Promise<boolean>
  downloadAvailable(): Promise<{ accepted: boolean; completed: boolean }>
  installDownloaded(): Promise<{ accepted: boolean; completed: boolean }>
  isUpdaterConfigured(): boolean
  setInstallInFlight(value: boolean): void
}

interface UpdaterRuntime {
  config: UpdaterConfig
  host: UpdaterHost
  state: DesktopUpdateState
  pollTimer: ReturnType<typeof setInterval> | null
  startupTimer: ReturnType<typeof setTimeout> | null
  checkInFlight: boolean
  downloadInFlight: boolean
  installInFlight: boolean
  configured: boolean
}

export function readAppUpdateYml(): Record<string, string> | null {
  try {
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, 'app-update.yml')
      : Path.join(app.getAppPath(), 'dev-app-update.yml')
    const raw = FS.readFileSync(ymlPath, 'utf-8')
    const entries: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/)
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim()
    }
    return entries.provider ? entries : null
  } catch {
    return null
  }
}

function clearPollTimer(rt: UpdaterRuntime): void {
  if (rt.startupTimer) {
    clearTimeout(rt.startupTimer)
    rt.startupTimer = null
  }
  if (rt.pollTimer) {
    clearInterval(rt.pollTimer)
    rt.pollTimer = null
  }
}

function emitState(rt: UpdaterRuntime): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(rt.config.updateStateChannel, rt.state)
  }
}

function setState(rt: UpdaterRuntime, patch: Partial<DesktopUpdateState>): void {
  rt.state = { ...rt.state, ...patch }
  emitState(rt)
}

function resolveErrorContext(rt: UpdaterRuntime): DesktopUpdateErrorContext {
  if (rt.installInFlight) return 'install'
  if (rt.downloadInFlight) return 'download'
  if (rt.checkInFlight) return 'check'
  return rt.state.errorContext
}

function shouldEnable(rt: UpdaterRuntime): boolean {
  return (
    getAutoUpdateDisabledReason({
      isDevelopment: rt.config.isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: rt.config.disabledByEnv,
    }) === null
  )
}

async function checkForUpdates(rt: UpdaterRuntime, reason: string): Promise<boolean> {
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) return false
  if (rt.host.isQuitting() || !rt.configured || rt.checkInFlight) return false
  if (rt.state.status === 'downloading' || rt.state.status === 'downloaded') {
    console.info(
      `[desktop-updater] Skipping update check (${reason}) while status=${rt.state.status}.`
    )
    return false
  }
  rt.checkInFlight = true
  setState(rt, reduceDesktopUpdateStateOnCheckStart(rt.state, new Date().toISOString()))
  console.info(`[desktop-updater] Checking for updates (${reason})...`)
  try {
    await autoUpdater.checkForUpdates()
    return true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    setState(
      rt,
      reduceDesktopUpdateStateOnCheckFailure(rt.state, message, new Date().toISOString())
    )
    console.error(`[desktop-updater] Failed to check for updates: ${message}`)
    return true
  } finally {
    rt.checkInFlight = false
  }
}

async function downloadAvailable(
  rt: UpdaterRuntime
): Promise<{ accepted: boolean; completed: boolean }> {
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) {
    return { accepted: false, completed: false }
  }
  if (!rt.configured || rt.downloadInFlight || rt.state.status !== 'available') {
    return { accepted: false, completed: false }
  }
  rt.downloadInFlight = true
  setState(rt, reduceDesktopUpdateStateOnDownloadStart(rt.state))
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(rt.config.runtimeInfo)
  console.info('[desktop-updater] Downloading update...')
  try {
    await autoUpdater.downloadUpdate()
    return { accepted: true, completed: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    setState(rt, reduceDesktopUpdateStateOnDownloadFailure(rt.state, message))
    console.error(`[desktop-updater] Failed to download update: ${message}`)
    return { accepted: true, completed: false }
  } finally {
    rt.downloadInFlight = false
  }
}

async function installDownloaded(
  rt: UpdaterRuntime
): Promise<{ accepted: boolean; completed: boolean }> {
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) {
    return { accepted: false, completed: false }
  }
  if (rt.host.isQuitting() || !rt.configured || rt.state.status !== 'downloaded') {
    return { accepted: false, completed: false }
  }
  rt.host.setQuitting(true)
  rt.installInFlight = true
  clearPollTimer(rt)
  try {
    await rt.host.stopBackendAndWaitForExit()
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy()
    }
    autoUpdater.quitAndInstall(true, true)
    return { accepted: true, completed: false }
  } catch (error: unknown) {
    const message = formatErrorMessage(error)
    rt.installInFlight = false
    rt.host.setQuitting(false)
    setState(rt, reduceDesktopUpdateStateOnInstallFailure(rt.state, message))
    console.error(`[desktop-updater] Failed to install update: ${message}`)
    return { accepted: true, completed: false }
  }
}

function configureGitHubFeed(autoUpdater: ElectronAutoUpdater, githubToken: string): void {
  const appUpdateYml = readAppUpdateYml()
  if (appUpdateYml?.provider !== 'github') {
    return
  }
  autoUpdater.setFeedURL({
    ...appUpdateYml,
    provider: 'github' as const,
    private: true,
    token: githubToken,
  })
}

function configureMockFeed(autoUpdater: ElectronAutoUpdater): void {
  if (!process.env.ORXA_DESKTOP_MOCK_UPDATES) {
    return
  }
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `http://localhost:${process.env.ORXA_DESKTOP_MOCK_UPDATE_SERVER_PORT ?? 3000}`,
  })
}

function handleUpdaterError(rt: UpdaterRuntime, error: unknown): void {
  const message = formatErrorMessage(error)
  if (rt.installInFlight) {
    rt.installInFlight = false
    rt.host.setQuitting(false)
    setState(rt, reduceDesktopUpdateStateOnInstallFailure(rt.state, message))
    console.error(`[desktop-updater] Updater error: ${message}`)
    return
  }
  if (!rt.checkInFlight && !rt.downloadInFlight) {
    setState(rt, {
      status: 'error',
      message,
      checkedAt: new Date().toISOString(),
      downloadPercent: null,
      errorContext: resolveErrorContext(rt),
      canRetry: rt.state.availableVersion !== null || rt.state.downloadedVersion !== null,
    })
  }
  console.error(`[desktop-updater] Updater error: ${message}`)
}

function registerEventHandlers(rt: UpdaterRuntime, autoUpdater: ElectronAutoUpdater): void {
  let lastLoggedDownloadMilestone = -1
  autoUpdater.on('checking-for-update', () => {
    console.info('[desktop-updater] Looking for updates...')
  })
  autoUpdater.on('update-available', info => {
    setState(
      rt,
      reduceDesktopUpdateStateOnUpdateAvailable(rt.state, info.version, new Date().toISOString())
    )
    lastLoggedDownloadMilestone = -1
    console.info(`[desktop-updater] Update available: ${info.version}`)
  })
  autoUpdater.on('update-not-available', () => {
    setState(rt, reduceDesktopUpdateStateOnNoUpdate(rt.state, new Date().toISOString()))
    lastLoggedDownloadMilestone = -1
    console.info('[desktop-updater] No updates available.')
  })
  autoUpdater.on('error', error => handleUpdaterError(rt, error))
  autoUpdater.on('download-progress', progress => {
    const percent = Math.floor(progress.percent)
    if (shouldBroadcastDownloadProgress(rt.state, progress.percent) || rt.state.message !== null) {
      setState(rt, reduceDesktopUpdateStateOnDownloadProgress(rt.state, progress.percent))
    }
    const milestone = percent - (percent % 10)
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone
      console.info(`[desktop-updater] Download progress: ${percent}%`)
    }
  })
  autoUpdater.on('update-downloaded', info => {
    setState(rt, reduceDesktopUpdateStateOnDownloadComplete(rt.state, info.version))
    console.info(`[desktop-updater] Update downloaded: ${info.version}`)
  })
}

function scheduleChecks(rt: UpdaterRuntime): void {
  clearPollTimer(rt)
  rt.startupTimer = setTimeout(() => {
    rt.startupTimer = null
    void checkForUpdates(rt, 'startup')
  }, rt.config.startupDelayMs)
  rt.startupTimer.unref()
  rt.pollTimer = setInterval(() => {
    void checkForUpdates(rt, 'poll')
  }, rt.config.pollIntervalMs)
  rt.pollTimer.unref()
}

function applyAutoUpdaterDefaults(rt: UpdaterRuntime, autoUpdater: ElectronAutoUpdater): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.channel = rt.config.channel
  autoUpdater.allowPrerelease = rt.config.allowPrerelease
  autoUpdater.allowDowngrade = false
  autoUpdater.disableDifferentialDownload = isArm64HostRunningIntelBuild(rt.config.runtimeInfo)
  if (isArm64HostRunningIntelBuild(rt.config.runtimeInfo)) {
    console.info(
      '[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.'
    )
  }
}

function setAllowPrerelease(rt: UpdaterRuntime, value: boolean): void {
  rt.config.allowPrerelease = value
  if (!rt.configured) return
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) return
  autoUpdater.allowPrerelease = value
}

function setChannel(rt: UpdaterRuntime, value: string): void {
  rt.config.channel = value
  if (!rt.configured) return
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) return
  autoUpdater.channel = value
}

function configure(rt: UpdaterRuntime): void {
  const enabled = shouldEnable(rt)
  setState(rt, {
    ...createInitialDesktopUpdateState(app.getVersion(), rt.config.runtimeInfo),
    enabled,
    status: enabled ? 'idle' : 'disabled',
  })
  if (!enabled) {
    return
  }
  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) {
    setState(rt, {
      enabled: false,
      status: 'disabled',
      message: 'Auto-updates unavailable in this build.',
      errorContext: 'check',
      canRetry: false,
    })
    return
  }
  rt.configured = true
  const githubToken =
    process.env.ORXA_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || ''
  if (githubToken) {
    configureGitHubFeed(autoUpdater, githubToken)
  }
  configureMockFeed(autoUpdater)
  applyAutoUpdaterDefaults(rt, autoUpdater)
  registerEventHandlers(rt, autoUpdater)
  scheduleChecks(rt)
}

export function createUpdaterController(
  config: UpdaterConfig,
  host: UpdaterHost
): UpdaterController {
  const rt: UpdaterRuntime = {
    config,
    host,
    state: createInitialDesktopUpdateState(app.getVersion(), config.runtimeInfo),
    pollTimer: null,
    startupTimer: null,
    checkInFlight: false,
    downloadInFlight: false,
    installInFlight: false,
    configured: false,
  }

  return {
    configure: () => configure(rt),
    clearPollTimer: () => clearPollTimer(rt),
    getState: () => rt.state,
    setState: patch => setState(rt, patch),
    setAllowPrerelease: value => setAllowPrerelease(rt, value),
    setChannel: value => setChannel(rt, value),
    checkForUpdates: reason => checkForUpdates(rt, reason),
    downloadAvailable: () => downloadAvailable(rt),
    installDownloaded: () => installDownloaded(rt),
    isUpdaterConfigured: () => rt.configured,
    setInstallInFlight: value => {
      rt.installInFlight = value
    },
  }
}
