#!/usr/bin/env node
import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DIST_DIR = path.resolve(process.cwd(), 'dist')
const APP_NAME = 'Orxa Code (Beta)'
const APP_FALLBACK_MAC_NAME = 'Orxa Code'
const APP_FALLBACK_LINUX_BINARY = 'orxa-code'

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function firstMatchingFile(directory, predicate) {
  const entries = await readdir(directory)
  for (const entry of entries) {
    const candidate = path.join(directory, entry)
    const info = await stat(candidate)
    if (!info.isFile()) {
      continue
    }
    if (predicate(entry, info.mode)) {
      return candidate
    }
  }
  return undefined
}

async function resolveExecutablePath() {
  if (process.platform === 'darwin') {
    const entries = await readdir(DIST_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('mac')) {
        continue
      }
      const appBundlePath = path.join(DIST_DIR, entry.name, `${APP_NAME}.app`)
      if (await pathExists(appBundlePath)) {
        return appBundlePath
      }
      const fallbackAppBundlePath = path.join(DIST_DIR, entry.name, `${APP_FALLBACK_MAC_NAME}.app`)
      if (await pathExists(fallbackAppBundlePath)) {
        return fallbackAppBundlePath
      }
      const macAppBinary = path.join(
        DIST_DIR,
        entry.name,
        `${APP_NAME}.app`,
        'Contents',
        'MacOS',
        APP_NAME
      )
      if (await pathExists(macAppBinary)) {
        return macAppBinary
      }
      const fallbackMacAppBinary = path.join(
        DIST_DIR,
        entry.name,
        `${APP_FALLBACK_MAC_NAME}.app`,
        'Contents',
        'MacOS',
        APP_FALLBACK_MAC_NAME
      )
      if (await pathExists(fallbackMacAppBinary)) {
        return fallbackMacAppBinary
      }
    }
  }

  if (process.platform === 'win32') {
    const windowsDir = path.join(DIST_DIR, 'win-unpacked')
    if (await pathExists(windowsDir)) {
      const exe = await firstMatchingFile(windowsDir, entry => entry.toLowerCase().endsWith('.exe'))
      if (exe) {
        return exe
      }
    }
  }

  const linuxDir = path.join(DIST_DIR, 'linux-unpacked')
  if (await pathExists(linuxDir)) {
    const preferredCandidates = [APP_NAME, APP_FALLBACK_LINUX_BINARY]
    for (const candidateName of preferredCandidates) {
      const candidate = path.join(linuxDir, candidateName)
      if (await pathExists(candidate)) {
        return candidate
      }
    }
    const executable = await firstMatchingFile(linuxDir, (entry, mode) => {
      const lower = entry.toLowerCase()
      return (
        !lower.includes('.so') &&
        !lower.startsWith('lib') &&
        !lower.startsWith('chrome') &&
        !lower.includes('crashpad') &&
        !lower.includes('sandbox') &&
        (mode & 0o111) !== 0
      )
    })
    if (executable) {
      return executable
    }
  }

  throw new Error(`Unable to find unpacked app binary under ${DIST_DIR}`)
}

async function runSmokeTest() {
  const executablePath = await resolveExecutablePath()
  const isMacAppBundle = process.platform === 'darwin' && executablePath.endsWith('.app')
  console.log(
    `Running smoke test with ${isMacAppBundle ? 'app bundle' : 'executable'}: ${executablePath}`
  )
  const launchArgs = isMacAppBundle
    ? ['-W', '-n', executablePath, '--args', '--smoke-test']
    : process.platform === 'linux'
      ? ['--smoke-test', '--no-sandbox', '--disable-setuid-sandbox']
      : ['--smoke-test']
  const launchCommand = isMacAppBundle ? 'open' : executablePath

  await new Promise((resolve, reject) => {
    const child = spawn(launchCommand, launchArgs, {
      env: {
        ...process.env,
        ORXA_SMOKE_TEST: '1',
        ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
      },
      stdio: 'inherit',
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Smoke test timed out'))
    }, 20_000)

    child.on('error', error => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('exit', code => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(undefined)
      } else {
        reject(new Error(`Smoke test app exited with code ${code ?? 'unknown'}`))
      }
    })
  })

  console.log('Smoke test passed.')
}

void runSmokeTest().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
