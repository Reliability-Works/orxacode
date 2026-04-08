// Keep the canonical Electron.app as the dev runtime on macOS.
// We only patch its visible app name/icon in place so the launcher stays stable.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DISPLAY_NAME = 'Orxa Code (Beta)'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const desktopDir = resolve(__dirname, '..')

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync('plutil', ['-replace', key, '-string', value, plistPath], {
    encoding: 'utf8',
  })
  if (replaceResult.status === 0) {
    return
  }

  const insertResult = spawnSync('plutil', ['-insert', key, '-string', value, plistPath], {
    encoding: 'utf8',
  })
  if (insertResult.status === 0) {
    return
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join('\n')
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim())
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, 'Contents', 'Info.plist')
  setPlistString(infoPlistPath, 'CFBundleDisplayName', APP_DISPLAY_NAME)
  setPlistString(infoPlistPath, 'CFBundleName', APP_DISPLAY_NAME)
  setPlistString(infoPlistPath, 'CFBundleIconFile', 'electron.icns')

  const resourcesDir = join(appBundlePath, 'Contents', 'Resources')
  copyFileSync(iconPath, join(resourcesDir, 'electron.icns'))
}

function cleanupStaleRuntimeBundles(runtimeDir) {
  if (!existsSync(runtimeDir)) {
    return
  }

  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
      continue
    }
    rmSync(join(runtimeDir, entry.name), { recursive: true, force: true })
  }
}

function syncCanonicalMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, '../../..')
  const runtimeDir = join(desktopDir, '.electron-runtime')
  const repoIconPath = resolve(desktopDir, '..', '..', 'build', 'icon.icns')
  const iconPath = existsSync(repoIconPath)
    ? repoIconPath
    : join(desktopDir, 'resources', 'icon.icns')

  mkdirSync(runtimeDir, { recursive: true })
  cleanupStaleRuntimeBundles(runtimeDir)
  patchMainBundleInfoPlist(sourceAppBundlePath, iconPath)

  return electronBinaryPath
}

export function resolveElectronPath() {
  const require = createRequire(import.meta.url)
  const electronBinaryPath = require('electron')

  if (process.platform !== 'darwin') {
    return electronBinaryPath
  }

  return syncCanonicalMacLauncher(electronBinaryPath)
}
