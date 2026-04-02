import { spawn } from 'node:child_process'

const defaultTimeoutMs = 900000
const timeoutMs = Number.parseInt(
  process.env.ORXA_COVERAGE_HOOK_TIMEOUT_MS ?? `${defaultTimeoutMs}`,
  10
)
const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultTimeoutMs
const failOnTimeout = process.env.ORXA_COVERAGE_HOOK_FAIL_ON_TIMEOUT === '1'

const child = spawn('pnpm', ['test:coverage:hook:raw'], {
  stdio: 'inherit',
  env: process.env,
})

let timedOut = false
const timeoutId = setTimeout(() => {
  timedOut = true
  process.stderr.write(
    `\n[test:coverage:hook] Timed out after ${resolvedTimeoutMs}ms. Terminating coverage run.\n`
  )
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL')
    }
  }, 10_000).unref()
}, resolvedTimeoutMs)

child.on('exit', (code, signal) => {
  clearTimeout(timeoutId)
  if (timedOut) {
    if (failOnTimeout) {
      process.exitCode = 1
      return
    }
    process.stderr.write(
      '[test:coverage:hook] Continuing despite timeout (ORXA_COVERAGE_HOOK_FAIL_ON_TIMEOUT=0).\n'
    )
    process.exitCode = 0
    return
  }
  if (signal) {
    process.stderr.write(`\n[test:coverage:hook] Coverage run exited via signal ${signal}.\n`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
