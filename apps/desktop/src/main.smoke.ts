import * as FS from 'node:fs'
import * as Path from 'node:path'

import { app, BrowserWindow } from 'electron'

export interface SmokeTestHost {
  writeLog(message: string): void
  resolveDesktopStaticDir(): string | null
  resolveBackendEntry(): string
  resolvePackagedModule(request: string): string
  isQuitting(): boolean
  setQuitting(value: boolean): void
}

function verifySmokeTestArtifact(host: SmokeTestHost): void {
  const staticRoot = host.resolveDesktopStaticDir()
  if (!staticRoot || !FS.existsSync(Path.join(staticRoot, 'index.html'))) {
    throw new Error('Smoke test static bundle missing.')
  }

  const backendEntry = host.resolveBackendEntry()
  if (!FS.existsSync(backendEntry)) {
    throw new Error(`Smoke test backend entry missing at ${backendEntry}.`)
  }

  host.resolvePackagedModule('effect')
  host.resolvePackagedModule('effect/Effect')
  host.resolvePackagedModule('@effect/platform-node/NodeRuntime')
  host.resolvePackagedModule('electron-updater')
}

export async function runSmokeTest(host: SmokeTestHost): Promise<void> {
  host.writeLog('smoke test start')
  verifySmokeTestArtifact(host)

  const smokeWindow = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (reason: string): void => {
        reject(new Error(reason))
      }

      smokeWindow.webContents.once('did-finish-load', () => resolve())
      smokeWindow.webContents.once('did-fail-load', (_event, code, description) => {
        fail(`Smoke renderer failed to load (${code}): ${description}`)
      })
      smokeWindow.webContents.once('render-process-gone', (_event, details) => {
        fail(`Smoke renderer exited unexpectedly: ${details.reason}`)
      })

      void smokeWindow.loadURL('data:text/html,<html><body>smoke</body></html>')
    })
  } finally {
    if (!smokeWindow.isDestroyed()) {
      smokeWindow.destroy()
    }
  }

  await new Promise(resolve => setTimeout(resolve, 250))
  if (host.isQuitting()) return
  host.setQuitting(true)
  host.writeLog('smoke test checks complete; quitting app')
  app.quit()
}
