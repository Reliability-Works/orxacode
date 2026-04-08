import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const webDevPort = Number(process.env.PORT ?? 5733)
const desktopDir = `${repoRoot}/apps/desktop`
const serverDir = `${repoRoot}/apps/server`
const webDir = `${repoRoot}/apps/web`
const nodeBin = process.execPath

const processes = [
  {
    name: 'web',
    cwd: webDir,
    command: nodeBin,
    args: [resolve(repoRoot, 'apps/web/node_modules/vite/bin/vite.js')],
  },
  {
    name: 'server-build',
    cwd: serverDir,
    command: nodeBin,
    args: [resolve(repoRoot, 'apps/server/node_modules/tsdown/dist/run.mjs'), '--watch'],
  },
  {
    name: 'desktop-bundle',
    cwd: desktopDir,
    command: nodeBin,
    args: [resolve(repoRoot, 'apps/desktop/node_modules/tsdown/dist/run.mjs'), '--watch'],
  },
  {
    name: 'desktop-electron',
    cwd: desktopDir,
    command: nodeBin,
    args: ['scripts/dev-electron.mjs'],
  },
]

const children = []
let shuttingDown = false

const staleRepoCommandMatchers = [
  command => command.includes(`${repoRoot}/apps/web/`) && command.includes('vite/bin/vite.js'),
  command =>
    command.includes(`${repoRoot}/apps/server/`) &&
    command.includes('tsdown') &&
    command.includes('--watch'),
  command =>
    command.includes(`${repoRoot}/apps/desktop/`) &&
    command.includes('tsdown') &&
    command.includes('--watch'),
  command => command.includes(`${repoRoot}/apps/desktop/.electron-runtime/`),
  command =>
    command.includes('Electron.app/Contents/MacOS/Electron') &&
    command.includes(`${repoRoot}/apps/server/dist/bin.mjs`),
  command =>
    command.includes('Electron.app/Contents/MacOS/Electron') &&
    command.includes(`--orxa-dev-root=${desktopDir}`),
]

function sleep(ms) {
  if (ms <= 0) {
    return
  }

  const seconds = Math.max(1, Math.ceil(ms / 1000))
  spawnSync('sleep', [String(seconds)], { stdio: 'ignore' })
}

function listListeningPids(port) {
  if (isWindows) {
    return []
  }

  try {
    const output = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .map(line => Number.parseInt(line.trim(), 10))
      .filter(pid => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

function readProcessCommand(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function readProcessCwd(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    return output
      .split('\n')
      .find(line => line.startsWith('n'))
      ?.slice(1)
      .trim()
  } catch {
    return undefined
  }
}

function isStaleRepoProcess(entry) {
  if (staleRepoCommandMatchers.some(matches => matches(entry.command))) {
    return true
  }

  if (!entry.command.includes('node scripts/dev-electron.mjs')) {
    return false
  }

  return readProcessCwd(entry.pid) === desktopDir
}

function listRepoProcessPids() {
  if (isWindows) {
    return []
  }

  try {
    const output = execFileSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const firstSpace = line.indexOf(' ')
        if (firstSpace === -1) {
          return null
        }

        const pid = Number.parseInt(line.slice(0, firstSpace).trim(), 10)
        const command = line.slice(firstSpace + 1).trim()
        if (!Number.isInteger(pid) || pid <= 0 || command.length === 0) {
          return null
        }

        return { pid, command }
      })
      .filter(entry => entry !== null)
      .filter(entry => entry.pid !== process.pid)
      .filter(entry => isStaleRepoProcess(entry))
      .map(entry => entry.pid)
  } catch {
    return []
  }
}

function terminatePids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

function cleanupStaleRepoProcesses() {
  const stalePids = listRepoProcessPids()
  if (stalePids.length === 0) {
    return
  }

  terminatePids(stalePids, 'SIGTERM')
  sleep(600)
  terminatePids(listRepoProcessPids(), 'SIGKILL')
}

function cleanupStaleWebDevServer() {
  const listeningPids = listListeningPids(webDevPort)
  if (listeningPids.length === 0) {
    return
  }

  const repoLocalPids = listeningPids.filter(pid => {
    const command = readProcessCommand(pid)
    return command.includes(`${repoRoot}/apps/web/`) && command.includes('vite')
  })

  const foreignPids = listeningPids.filter(pid => !repoLocalPids.includes(pid))
  if (foreignPids.length > 0) {
    const details = foreignPids
      .map(pid => `${pid}: ${readProcessCommand(pid) || 'unknown command'}`)
      .join('\n')
    throw new Error(`Port ${webDevPort} is already in use by a non-repo process:\n${details}`)
  }

  for (const pid of repoLocalPids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }

  sleep(600)

  for (const pid of listListeningPids(webDevPort)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

function spawnProcess(config) {
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    stdio: 'inherit',
    shell: false,
    detached: !isWindows,
    env: process.env,
  })

  children.push({ name: config.name, child })

  child.on('error', error => {
    if (shuttingDown) {
      return
    }

    console.error(`[dev:${config.name}] failed to start`, error)
    void shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    const exitCode = code ?? (signal ? 1 : 0)
    if (exitCode !== 0) {
      console.error(`[dev:${config.name}] exited with code ${exitCode}`)
      void shutdown(exitCode)
      return
    }

    console.log(`[dev:${config.name}] exited cleanly; stopping all dev processes`)
    void shutdown(0)
  })
}

function killChild(child, signal) {
  if (isWindows) {
    child.kill(signal)
    return
  }

  if (typeof child.pid === 'number') {
    process.kill(-child.pid, signal)
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        killChild(child, 'SIGTERM')
      } catch {}
    }
  }

  await new Promise(resolve => setTimeout(resolve, 1200))

  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        killChild(child, 'SIGKILL')
      } catch {}
    }
  }

  try {
    cleanupStaleRepoProcesses()
    cleanupStaleWebDevServer()
  } catch {}

  process.exit(exitCode)
}

try {
  cleanupStaleRepoProcesses()
  cleanupStaleWebDevServer()
  for (const config of processes) {
    spawnProcess(config)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dev:bootstrap] ${message}`)
  process.exit(1)
}

process.once('SIGINT', () => {
  void shutdown(0)
})

process.once('SIGTERM', () => {
  void shutdown(0)
})
