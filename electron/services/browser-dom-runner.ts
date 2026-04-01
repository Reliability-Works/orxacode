import type { WebContents } from 'electron'
import type { BrowserAgentActionRequest, BrowserLocator } from '../../shared/ipc'
import { buildInteractionScript, buildRecoveryScript } from './browser-dom-scripts'
import { delay, normalizeErrorMessage } from './browser-controller-utils'
import type { BrowserTabRecord } from './browser-controller-types'

export async function runDomAction(
  webContents: WebContents,
  script: string,
  actionName: BrowserAgentActionRequest['action']
): Promise<Record<string, unknown>> {
  const result = await webContents.executeJavaScript(script, true)
  if (!result || typeof result !== 'object') {
    return {}
  }
  const payload = result as { ok?: unknown; error?: unknown } & Record<string, unknown>
  if (payload.ok === false) {
    const details = typeof payload.error === 'string' ? payload.error : 'Unknown DOM action failure'
    throw new Error(`${actionName} failed: ${details}`)
  }
  return payload
}

export async function runDomActionWithRetry(
  webContents: WebContents,
  script: string,
  actionName: BrowserAgentActionRequest['action'],
  attempts: number
): Promise<Record<string, unknown> & { attempt: number }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const outcome = await runDomAction(webContents, script, actionName)
      return { ...outcome, attempt }
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await runRecoveryPlanner(webContents, attempt)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(normalizeErrorMessage(lastError))
}

async function runRecoveryPlanner(webContents: WebContents, attempt: number) {
  if (webContents.isLoading()) {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(
        () => {
          webContents.off('did-stop-loading', onStop)
          resolve()
        },
        Math.max(800, 120 * 8)
      )
      const onStop = () => {
        clearTimeout(timeout)
        webContents.off('did-stop-loading', onStop)
        resolve()
      }
      webContents.on('did-stop-loading', onStop)
    })
  }
  if (attempt <= 1) {
    await delay(120)
    return
  }
  const step = attempt === 2 ? 'dismiss_overlays' : 'stabilize'
  await webContents.executeJavaScript(buildRecoveryScript(step), true).catch(() => undefined)
  await delay(120 * attempt)
}

export async function waitForLocatorState(
  webContents: WebContents,
  locator: BrowserLocator,
  state: 'attached' | 'visible' | 'hidden',
  timeoutMs: number
) {
  const startedAt = Date.now()
  let attempts = 0
  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1
    const outcome = await runDomAction(
      webContents,
      buildInteractionScript('inspect', locator, { timeoutMs }),
      'wait_for'
    )
    const found = Boolean(outcome.found)
    const visible = Boolean(outcome.visible)
    const satisfied =
      state === 'attached' ? found : state === 'visible' ? visible : !found || !visible
    if (satisfied) {
      return {
        found,
        visible,
        attempts,
        selectorUsed: outcome.selectorUsed,
        strategyUsed: outcome.strategyUsed,
      }
    }
    await delay(120)
  }
  throw new Error(`wait_for timed out after ${timeoutMs}ms`)
}

export async function waitForNavigation(record: BrowserTabRecord, timeoutMs: number) {
  const webContents = record.view.webContents
  record.lastActivityAt = Date.now()

  if (webContents.isLoading()) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        webContents.off('did-stop-loading', onStop)
        reject(new Error(`Navigation timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      const onStop = () => {
        clearTimeout(timeout)
        webContents.off('did-stop-loading', onStop)
        resolve()
      }
      webContents.on('did-stop-loading', onStop)
    })
    return
  }

  const watchMs = Math.min(timeoutMs, 1_500)
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      webContents.off('did-start-loading', onStart)
      webContents.off('did-navigate', onNavigate)
      resolve()
    }, watchMs)
    const cleanup = () => {
      clearTimeout(timeout)
      webContents.off('did-start-loading', onStart)
      webContents.off('did-navigate', onNavigate)
    }
    const onStart = () => {
      cleanup()
      waitForNavigation(record, timeoutMs)
        .then(() => resolve())
        .catch(() => resolve())
    }
    const onNavigate = () => {
      cleanup()
      resolve()
    }
    webContents.on('did-start-loading', onStart)
    webContents.on('did-navigate', onNavigate)
  })
}

export async function waitForIdle(record: BrowserTabRecord, idleMs: number, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const elapsed = Date.now() - record.lastActivityAt
    if (!record.view.webContents.isLoading() && elapsed >= idleMs) {
      return
    }
    await delay(120)
  }
  throw new Error(`wait_for_idle timed out after ${timeoutMs}ms`)
}
