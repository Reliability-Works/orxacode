import { app, dialog } from 'electron'

import { formatErrorMessage } from './main.logging'

export function handleDesktopFatalStartupError(input: {
  readonly stage: string
  readonly error: unknown
  readonly isQuitting: boolean
  setQuitting(value: boolean): void
  writeLog(message: string): void
  stopBackend(): void
  restoreLogging(): void
}): void {
  const message = formatErrorMessage(input.error)
  const detail =
    input.error instanceof Error && typeof input.error.stack === 'string'
      ? `\n${input.error.stack}`
      : ''
  input.writeLog(`fatal startup error stage=${input.stage} message=${message}`)
  console.error(`[desktop] fatal startup error (${input.stage})`, input.error)
  if (!input.isQuitting) {
    input.setQuitting(true)
    dialog.showErrorBox('Orxa Code failed to start', `Stage: ${input.stage}\n${message}${detail}`)
  }
  input.stopBackend()
  input.restoreLogging()
  app.quit()
}

export async function checkForDesktopUpdatesFromMenu(input: {
  checkForUpdates(source: 'menu'): Promise<unknown>
  getState(): {
    status: 'up-to-date' | 'error' | string
    currentVersion?: string
    message?: string | null
  }
}): Promise<void> {
  await input.checkForUpdates('menu')
  const state = input.getState()
  if (state.status === 'up-to-date') {
    await dialog.showMessageBox({
      type: 'info',
      title: "You're up to date!",
      message: `Orxa Code ${state.currentVersion} is currently the newest version available.`,
      buttons: ['OK'],
    })
    return
  }
  if (state.status === 'error') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: state.message ?? 'An unknown error occurred. Please try again later.',
      buttons: ['OK'],
    })
  }
}
