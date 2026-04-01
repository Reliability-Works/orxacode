import { app, BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateCheckResult, UpdatePreferences, UpdateReleaseChannel } from '../../shared/ipc'
import {
  ElectronUpdatePreferencesStore,
  type UpdatePreferencesStore,
} from './auto-updater-preferences'

const INITIAL_UPDATE_CHECK_DELAY_MS = 12_000
const PERIODIC_UPDATE_CHECK_MS = 4 * 60 * 60 * 1000

type AutoUpdaterLike = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void
}

type AutoUpdaterDeps = {
  isPackaged: boolean
  appVersion: string
  updater: AutoUpdaterLike
  showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions
  ) => Promise<{ response: number }>
  now: () => number
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  setIntervalFn: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>
  clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void
  clearIntervalFn: (timer: ReturnType<typeof setInterval>) => void
}

type TelemetryPayload = {
  phase:
    | 'check.start'
    | 'check.success'
    | 'check.error'
    | 'update.available'
    | 'download.start'
    | 'download.progress'
    | 'download.complete'
    | 'install.start'
  manual: boolean
  releaseChannel: UpdateReleaseChannel
  durationMs?: number
  percent?: number
  message?: string
  version?: string
}

export type AutoUpdaterController = {
  cleanup: () => void
  getPreferences: () => UpdatePreferences
  setPreferences: (input: Partial<UpdatePreferences>) => UpdatePreferences
  checkNow: () => Promise<UpdateCheckResult>
  downloadAndInstall: () => Promise<UpdateCheckResult>
}

type EventHandlers = ReturnType<typeof createEventHandlers>

function createCleanupHandler(
  updater: AutoUpdaterLike,
  handlers: EventHandlers,
  clearTimers: () => void
): () => void {
  return () => {
    clearTimers()
    updater.removeListener('update-available', handlers.onUpdateAvailable as (...args: unknown[]) => void)
    updater.removeListener('update-not-available', handlers.onUpdateNotAvailable as (...args: unknown[]) => void)
    updater.removeListener('download-progress', handlers.onDownloadProgress as (...args: unknown[]) => void)
    updater.removeListener('update-downloaded', handlers.onUpdateDownloaded as (...args: unknown[]) => void)
    updater.removeListener('error', handlers.onError as (...args: unknown[]) => void)
  }
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Unknown updater error'
}

function isMissingReleaseError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase()
  if (message.includes('unable to find latest version on github')) return true
  if (message.includes('/releases/latest') && message.includes('httperror: 406')) return true
  if (message.includes('latest-mac.yml') && message.includes('httperror: 404')) return true
  if (message.includes('latest-linux.yml') && message.includes('httperror: 404')) return true
  if (message.includes('latest.yml') && message.includes('httperror: 404')) return true
  if (message.includes('cannot find') && message.includes('latest') && message.includes('release artifacts')) return true
  return false
}

async function showMessage(
  deps: AutoUpdaterDeps,
  getWindow: () => BrowserWindow | null,
  options: MessageBoxOptions
): Promise<{ response: number }> {
  return deps.showMessageBox(getWindow(), options)
}

function createDefaultDeps(): AutoUpdaterDeps {
  return {
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    updater: autoUpdater as unknown as AutoUpdaterLike,
    showMessageBox: async (window, options) => {
      return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
    },
    now: () => Date.now(),
    setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
    setIntervalFn: (callback, delayMs) => setInterval(callback, delayMs),
    clearTimeoutFn: timer => clearTimeout(timer),
    clearIntervalFn: timer => clearInterval(timer),
  }
}

type UpdaterState = {
  initialTimer: ReturnType<typeof setTimeout> | undefined
  intervalTimer: ReturnType<typeof setInterval> | undefined
  pendingManualResult: boolean
  activeCheckManual: boolean
  isCheckingForUpdates: boolean
  activeCheckStartedAt: number
  availableVersion: string | undefined
  isDownloadingUpdate: boolean
  activeDownloadManual: boolean
  installAfterDownload: boolean
}

function createUpdaterState(): UpdaterState {
  return {
    initialTimer: undefined,
    intervalTimer: undefined,
    pendingManualResult: false,
    activeCheckManual: false,
    isCheckingForUpdates: false,
    activeCheckStartedAt: 0,
    availableVersion: undefined,
    isDownloadingUpdate: false,
    activeDownloadManual: false,
    installAfterDownload: false,
  }
}

type EventHandlerContext = {
  state: UpdaterState
  deps: AutoUpdaterDeps
  getWindow: () => BrowserWindow | null
  updater: AutoUpdaterLike
  preferences: UpdatePreferences
  emitTelemetry: (payload: Omit<TelemetryPayload, 'releaseChannel'>) => void
  resetProgressBar: () => void
  clearTimers: () => void
  scheduleChecks: () => void
  setPreferences: (input: Partial<UpdatePreferences>) => UpdatePreferences
}

function extractVersion(info?: unknown): string | undefined {
  if (
    info &&
    typeof info === 'object' &&
    'version' in info &&
    typeof (info as { version?: unknown }).version === 'string'
  ) {
    return (info as { version: string }).version
  }
  return undefined
}

function createTelemetryHandlers(ctx: EventHandlerContext) {
  const { state, deps, emitTelemetry } = ctx

  const onUpdateAvailable = async (info?: unknown) => {
    const manual = state.activeCheckManual
    state.pendingManualResult = false

    const version = extractVersion(info)
    if (version) state.availableVersion = version

    emitTelemetry({ phase: 'update.available', manual, version })
    emitTelemetry({
      phase: 'check.success',
      manual,
      durationMs: deps.now() - state.activeCheckStartedAt,
      version,
    })
    state.isCheckingForUpdates = false
    state.activeCheckManual = false
  }

  const onDownloadProgress = (progress: { percent: number }) => {
    const ratio = Number.isFinite(progress.percent)
      ? Math.max(0, Math.min(1, progress.percent / 100))
      : 0
    const targetWindow = ctx.getWindow()
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.setProgressBar(ratio)
    }
    emitTelemetry({
      phase: 'download.progress',
      manual: state.activeDownloadManual,
      percent: Number.isFinite(progress.percent) ? progress.percent : undefined,
      version: state.availableVersion,
    })
  }

  return { onUpdateAvailable, onDownloadProgress }
}

function createMessageHandlers(ctx: EventHandlerContext) {
  const { state, deps, getWindow, updater, emitTelemetry, resetProgressBar } = ctx

  const onUpdateNotAvailable = async () => {
    const manual = state.activeCheckManual || state.pendingManualResult
    state.pendingManualResult = false
    emitTelemetry({
      phase: 'check.success',
      manual,
      durationMs: deps.now() - state.activeCheckStartedAt,
    })
    state.isCheckingForUpdates = false
    state.activeCheckManual = false

    if (!manual) return
    await showMessage(deps, getWindow, {
      type: 'info',
      title: 'No updates found',
      message: 'You are already on the latest version.',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
    })
  }

  const onUpdateDownloaded = async (info?: unknown) => {
    resetProgressBar()
    const version = extractVersion(info)
    emitTelemetry({
      phase: 'download.complete',
      manual: state.activeDownloadManual,
      version,
    })
    state.isDownloadingUpdate = false

    if (state.installAfterDownload) {
      emitTelemetry({
        phase: 'install.start',
        manual: state.activeDownloadManual,
        version,
      })
      state.installAfterDownload = false
      state.activeDownloadManual = false
      state.availableVersion = undefined
      updater.quitAndInstall()
      return
    }
    state.activeDownloadManual = false
  }

  const onError = async (error: unknown): Promise<'fatal' | 'nonfatal'> => {
    resetProgressBar()
    const manual = state.activeCheckManual || state.pendingManualResult || state.activeDownloadManual
    const wasDownloading = state.isDownloadingUpdate
    const message = formatErrorMessage(error)
    const durationMs = state.activeCheckStartedAt > 0 ? deps.now() - state.activeCheckStartedAt : undefined
    state.isDownloadingUpdate = false
    state.activeDownloadManual = false
    state.installAfterDownload = false

    if (isMissingReleaseError(error)) {
      emitTelemetry({
        phase: 'check.success',
        manual,
        durationMs,
        message: 'No update available — release not found or not yet published.',
      })
      state.pendingManualResult = false
      state.isCheckingForUpdates = false
      state.activeCheckManual = false

      if (manual) {
        await showMessage(deps, getWindow, {
          type: 'info',
          title: 'Already up to date',
          message: 'No updates available right now.',
          detail: "The release may still be building, or you're already on the latest version.",
          buttons: ['OK'],
          defaultId: 0,
          cancelId: 0,
        })
      }
      console.info('Auto update check: no release artifact found (may not be published yet).')
      return 'nonfatal'
    }

    emitTelemetry({ phase: 'check.error', manual, durationMs, message })
    state.pendingManualResult = false
    state.isCheckingForUpdates = false
    state.activeCheckManual = false

    if (manual) {
      await showMessage(deps, getWindow, {
        type: 'error',
        title: wasDownloading ? 'Update download failed' : 'Update check failed',
        message: wasDownloading
          ? 'Unable to download updates right now.'
          : 'Unable to check for updates right now.',
        detail: message,
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
      })
    }
    console.error('Auto update error:', error)
    return 'fatal'
  }

  return { onUpdateNotAvailable, onUpdateDownloaded, onError }
}

function createEventHandlers(ctx: EventHandlerContext) {
  const telemetry = createTelemetryHandlers(ctx)
  const messages = createMessageHandlers(ctx)
  return { ...telemetry, ...messages }
}

function createCheckForUpdates(
  state: UpdaterState,
  deps: AutoUpdaterDeps,
  updater: AutoUpdaterLike,
  emitTelemetry: (payload: Omit<TelemetryPayload, 'releaseChannel'>) => void,
  onError: (error: unknown) => Promise<'fatal' | 'nonfatal'>
) {
  return async (manual: boolean): Promise<UpdateCheckResult> => {
    if (!deps.isPackaged) {
      return {
        ok: true,
        status: 'skipped',
        message: 'Update checks run only in packaged builds.',
      }
    }

    if (state.isCheckingForUpdates) {
      return {
        ok: true,
        status: 'skipped',
        message: 'An update check is already in progress.',
      }
    }

    state.isCheckingForUpdates = true
    state.pendingManualResult = manual
    state.activeCheckManual = manual
    state.activeCheckStartedAt = deps.now()
    emitTelemetry({ phase: 'check.start', manual })

    try {
      await updater.checkForUpdates()
      return {
        ok: true,
        status: 'started',
      }
    } catch (error) {
      const outcome = await onError(error)
      if (outcome === 'nonfatal') {
        return {
          ok: true,
          status: 'skipped',
          message: 'Already up to date.',
        }
      }
      return {
        ok: false,
        status: 'error',
        message: formatErrorMessage(error),
      }
    }
  }
}

function createDownloadAndInstall(
  state: UpdaterState,
  deps: AutoUpdaterDeps,
  updater: AutoUpdaterLike,
  emitTelemetry: (payload: Omit<TelemetryPayload, 'releaseChannel'>) => void,
  onError: (error: unknown) => Promise<'fatal' | 'nonfatal'>
) {
  return async (): Promise<UpdateCheckResult> => {
    if (!deps.isPackaged) {
      return {
        ok: true,
        status: 'skipped',
        message: 'Update installs run only in packaged builds.',
      }
    }
    if (state.isDownloadingUpdate) {
      return {
        ok: true,
        status: 'skipped',
        message: 'An update download is already in progress.',
      }
    }
    if (!state.availableVersion) {
      return {
        ok: true,
        status: 'skipped',
        message: 'No update is currently available. Check for updates first.',
      }
    }

    state.isDownloadingUpdate = true
    state.activeDownloadManual = true
    state.installAfterDownload = true
    emitTelemetry({
      phase: 'download.start',
      manual: true,
      version: state.availableVersion,
    })
    void updater.downloadUpdate().catch(async error => {
      await onError(error)
    })

    return {
      ok: true,
      status: 'started',
    }
  }
}

export function createAutoUpdaterController(options: {
  deps: AutoUpdaterDeps
  getWindow: () => BrowserWindow | null
  store: UpdatePreferencesStore
  publishTelemetry?: (payload: TelemetryPayload) => void
}): AutoUpdaterController {
  const { deps, getWindow, store } = options
  const publishTelemetry = options.publishTelemetry ?? (() => undefined)
  const updater = deps.updater

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true

  let preferences = store.get()
  if (store.syncInstalledVersion) {
    preferences = store.syncInstalledVersion(deps.appVersion)
  }
  updater.allowPrerelease = preferences.releaseChannel === 'prerelease'

  const state = createUpdaterState()

  const resetProgressBar = () => {
    const targetWindow = getWindow()
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.setProgressBar(-1)
    }
  }

  const emitTelemetry = (payload: Omit<TelemetryPayload, 'releaseChannel'>) => {
    publishTelemetry({
      ...payload,
      releaseChannel: preferences.releaseChannel,
    })
  }

  const clearTimers = () => {
    if (state.initialTimer) {
      deps.clearTimeoutFn(state.initialTimer)
      state.initialTimer = undefined
    }
    if (state.intervalTimer) {
      deps.clearIntervalFn(state.intervalTimer)
      state.intervalTimer = undefined
    }
  }

  const scheduleChecks = () => {
    clearTimers()
    if (!deps.isPackaged || !preferences.autoCheckEnabled) {
      return
    }

    state.initialTimer = deps.setTimeoutFn(() => {
      void checkForUpdates(false)
    }, INITIAL_UPDATE_CHECK_DELAY_MS)

    state.intervalTimer = deps.setIntervalFn(() => {
      void checkForUpdates(false)
    }, PERIODIC_UPDATE_CHECK_MS)
  }

  const setPreferences = (input: Partial<UpdatePreferences>): UpdatePreferences => {
    preferences = store.set(input)
    updater.allowPrerelease = preferences.releaseChannel === 'prerelease'
    scheduleChecks()
    return preferences
  }

  // Create event handlers after scheduleChecks is defined
  const eventHandlers = createEventHandlers({
    state,
    deps,
    getWindow,
    updater,
    preferences,
    emitTelemetry,
    resetProgressBar,
    clearTimers,
    scheduleChecks,
    setPreferences,
  })

  const checkForUpdates = createCheckForUpdates(state, deps, updater, emitTelemetry, eventHandlers.onError)
  const downloadAndInstall = createDownloadAndInstall(state, deps, updater, emitTelemetry, eventHandlers.onError)

  updater.on('update-available', eventHandlers.onUpdateAvailable as (...args: unknown[]) => void)
  updater.on('update-not-available', eventHandlers.onUpdateNotAvailable as (...args: unknown[]) => void)
  updater.on('download-progress', eventHandlers.onDownloadProgress as (...args: unknown[]) => void)
  updater.on('update-downloaded', eventHandlers.onUpdateDownloaded as (...args: unknown[]) => void)
  updater.on('error', eventHandlers.onError as (...args: unknown[]) => void)

  scheduleChecks()

  return {
    cleanup: createCleanupHandler(updater, eventHandlers, clearTimers),
    getPreferences: () => preferences,
    setPreferences,
    checkNow: () => checkForUpdates(true),
    downloadAndInstall,
  }
}

export function setupAutoUpdates(
  getWindow: () => BrowserWindow | null,
  publishTelemetry?: (payload: TelemetryPayload) => void
): AutoUpdaterController {
  return createAutoUpdaterController({
    deps: createDefaultDeps(),
    getWindow,
    store: new ElectronUpdatePreferencesStore(),
    publishTelemetry,
  })
}
