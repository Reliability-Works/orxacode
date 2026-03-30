import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { BrowserAgentActionRequest, BrowserBounds, BrowserLocator } from '../../shared/ipc'

import {
  assertBoolean,
  assertFiniteNumber,
  assertOptionalString,
  assertString,
  assertStringArray,
} from './validators-core'

export function assertBrowserBoundsInput(value: unknown): BrowserBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Browser bounds payload is required')
  }
  const payload = value as Partial<BrowserBounds>
  const width = assertFiniteNumber(payload.width, 'bounds.width')
  const height = assertFiniteNumber(payload.height, 'bounds.height')
  return {
    x: assertFiniteNumber(payload.x, 'bounds.x'),
    y: assertFiniteNumber(payload.y, 'bounds.y'),
    width,
    height,
  }
}

export function assertOptionalBrowserBoundsInput(
  value: unknown
): Partial<BrowserBounds> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('bounds must be an object')
  }
  const payload = value as Partial<BrowserBounds>
  const output: Partial<BrowserBounds> = {}
  if (payload.x !== undefined) {
    output.x = assertFiniteNumber(payload.x, 'bounds.x')
  }
  if (payload.y !== undefined) {
    output.y = assertFiniteNumber(payload.y, 'bounds.y')
  }
  if (payload.width !== undefined) {
    output.width = assertFiniteNumber(payload.width, 'bounds.width')
  }
  if (payload.height !== undefined) {
    output.height = assertFiniteNumber(payload.height, 'bounds.height')
  }
  return output
}

export function assertOptionalBrowserLocatorInput(value: unknown): BrowserLocator | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('locator must be an object')
  }
  const payload = value as Record<string, unknown>
  const locator: BrowserLocator = {}
  if (payload.selector !== undefined) {
    locator.selector = assertString(payload.selector, 'locator.selector')
  }
  if (payload.selectors !== undefined) {
    locator.selectors = assertStringArray(payload.selectors, 'locator.selectors', 24)
  }
  if (payload.text !== undefined) {
    locator.text = assertString(payload.text, 'locator.text')
  }
  if (payload.role !== undefined) {
    locator.role = assertString(payload.role, 'locator.role')
  }
  if (payload.name !== undefined) {
    locator.name = assertString(payload.name, 'locator.name')
  }
  if (payload.label !== undefined) {
    locator.label = assertString(payload.label, 'locator.label')
  }
  if (payload.frameSelector !== undefined) {
    locator.frameSelector = assertString(payload.frameSelector, 'locator.frameSelector')
  }
  if (payload.includeShadowDom !== undefined) {
    locator.includeShadowDom = assertBoolean(payload.includeShadowDom, 'locator.includeShadowDom')
  }
  if (payload.exact !== undefined) {
    locator.exact = assertBoolean(payload.exact, 'locator.exact')
  }
  return locator
}

export function createAssertBrowserSender(getMainWindow: () => BrowserWindow | null) {
  return (event: IpcMainInvokeEvent) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window is not available')
    }
    if (event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Unauthorized browser IPC sender')
    }
  }
}

function assertBrowserActionRequestPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Browser action payload is required')
  }
  return value as Record<string, unknown>
}

function assertBrowserActionName(
  payload: Record<string, unknown>
): BrowserAgentActionRequest['action'] {
  if (typeof payload.action !== 'string') {
    throw new Error('Browser action is required')
  }
  return payload.action as BrowserAgentActionRequest['action']
}

function toOptionalFlooredNumber(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : Math.floor(assertFiniteNumber(value, field))
}

function assertScrollBehavior(value: unknown): 'auto' | 'smooth' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'auto' || value === 'smooth') {
    return value
  }
  throw new Error("scroll behavior must be 'auto' or 'smooth'")
}

function assertWaitForState(value: unknown): 'attached' | 'visible' | 'hidden' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'attached' || value === 'visible' || value === 'hidden') {
    return value
  }
  throw new Error("wait_for state must be 'attached', 'visible', or 'hidden'")
}

function assertScreenshotFormat(value: unknown): 'png' | 'jpeg' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'png' || value === 'jpeg') {
    return value
  }
  throw new Error("screenshot format must be 'png' or 'jpeg'")
}

function buildBrowserCloseTabAction(
  tabID: string | undefined
): Extract<BrowserAgentActionRequest, { action: 'close_tab' }> {
  return { action: 'close_tab', tabID }
}

function buildBrowserSwitchTabAction(
  tabID: string
): Extract<BrowserAgentActionRequest, { action: 'switch_tab' }> {
  return { action: 'switch_tab', tabID }
}

function buildBrowserOptionalTabAction(
  action: 'back' | 'forward' | 'reload',
  tabID: string | undefined
) {
  return { action, tabID }
}

function buildBrowserOpenTabAction(
  action: 'open_tab',
  payload: Record<string, unknown>
) : Extract<BrowserAgentActionRequest, { action: 'open_tab' }> {
  return {
    action,
    url: assertOptionalString(payload.url, 'url'),
    activate:
      payload.activate === undefined ? undefined : assertBoolean(payload.activate, 'activate'),
  }
}

function buildBrowserNavigateAction(
  action: 'navigate',
  payload: Record<string, unknown>,
  tabID: string | undefined
) : Extract<BrowserAgentActionRequest, { action: 'navigate' }> {
  return {
    action,
    url: assertString(payload.url, 'url'),
    tabID,
  }
}

function buildBrowserClickAction(
  action: 'click',
  payload: Record<string, unknown>,
  tabID: string | undefined,
  locator: BrowserLocator | undefined,
  timeoutMs: number | undefined,
  maxAttempts: number | undefined
) : Extract<BrowserAgentActionRequest, { action: 'click' }> {
  return {
    action,
    tabID,
    selector: assertOptionalString(payload.selector, 'selector'),
    locator,
    timeoutMs,
    maxAttempts,
    waitForNavigation:
      payload.waitForNavigation === undefined
        ? undefined
        : assertBoolean(payload.waitForNavigation, 'waitForNavigation'),
  }
}

function buildBrowserTypeAction(
  action: 'type',
  payload: Record<string, unknown>,
  tabID: string | undefined,
  locator: BrowserLocator | undefined,
  timeoutMs: number | undefined,
  maxAttempts: number | undefined
) : Extract<BrowserAgentActionRequest, { action: 'type' }> {
  return {
    action,
    text: assertString(payload.text, 'text'),
    tabID,
    selector: assertOptionalString(payload.selector, 'selector'),
    locator,
    submit: payload.submit === undefined ? undefined : assertBoolean(payload.submit, 'submit'),
    clear: payload.clear === undefined ? undefined : assertBoolean(payload.clear, 'clear'),
    timeoutMs,
    maxAttempts,
  }
}

function buildBrowserExtractTextAction(
  action: 'extract_text',
  payload: Record<string, unknown>,
  tabID: string | undefined,
  locator: BrowserLocator | undefined,
  timeoutMs: number | undefined,
  maxAttempts: number | undefined
) : Extract<BrowserAgentActionRequest, { action: 'extract_text' }> {
  return {
    action,
    selector: assertOptionalString(payload.selector, 'selector'),
    tabID,
    maxLength:
      payload.maxLength === undefined
        ? undefined
        : Math.floor(assertFiniteNumber(payload.maxLength, 'maxLength')),
    locator,
    timeoutMs,
    maxAttempts,
  }
}

function buildBrowserWaitForAction(
  action: 'wait_for',
  payload: Record<string, unknown>,
  tabID: string | undefined,
  locator: BrowserLocator | undefined,
  timeoutMs: number | undefined
) : Extract<BrowserAgentActionRequest, { action: 'wait_for' }> {
  return {
    action,
    selector: assertOptionalString(payload.selector, 'selector'),
    tabID,
    locator,
    timeoutMs,
    state: assertWaitForState(payload.state),
  }
}

function buildBrowserWaitForIdleAction(
  action: 'wait_for_idle',
  tabID: string | undefined,
  timeoutMs: number | undefined,
  payload: Record<string, unknown>
) : Extract<BrowserAgentActionRequest, { action: 'wait_for_idle' }> {
  return {
    action,
    tabID,
    timeoutMs,
    idleMs:
      payload.idleMs === undefined
        ? undefined
        : Math.floor(assertFiniteNumber(payload.idleMs, 'idleMs')),
  }
}

function buildBrowserScreenshotAction(
  action: 'screenshot',
  payload: Record<string, unknown>,
  tabID: string | undefined
) : Extract<BrowserAgentActionRequest, { action: 'screenshot' }> {
  return {
    action,
    tabID,
    format: assertScreenshotFormat(payload.format),
    quality:
      payload.quality === undefined ? undefined : assertFiniteNumber(payload.quality, 'quality'),
    bounds: assertOptionalBrowserBoundsInput(payload.bounds),
    workspace:
      payload.workspace === undefined ? undefined : assertString(payload.workspace, 'workspace'),
    sessionID:
      payload.sessionID === undefined ? undefined : assertString(payload.sessionID, 'sessionID'),
    actionID:
      payload.actionID === undefined ? undefined : assertString(payload.actionID, 'actionID'),
  }
}

export function assertBrowserAgentActionRequest(value: unknown): BrowserAgentActionRequest {
  const payload = assertBrowserActionRequestPayload(value)
  const action = assertBrowserActionName(payload)
  const tabID = assertOptionalString(payload.tabID, 'tabID')
  const timeoutMs = toOptionalFlooredNumber(payload.timeoutMs, 'timeoutMs')
  const maxAttempts = toOptionalFlooredNumber(payload.maxAttempts, 'maxAttempts')
  const locator = assertOptionalBrowserLocatorInput(payload.locator)
  const actionHandlers: Partial<
    Record<BrowserAgentActionRequest['action'], () => BrowserAgentActionRequest>
  > = {
    open_tab: () => buildBrowserOpenTabAction('open_tab', payload),
    close_tab: () => buildBrowserCloseTabAction(tabID),
    switch_tab: () => buildBrowserSwitchTabAction(assertString(payload.tabID, 'tabID')),
    navigate: () => buildBrowserNavigateAction('navigate', payload, tabID),
    back: () => buildBrowserOptionalTabAction('back', tabID),
    forward: () => buildBrowserOptionalTabAction('forward', tabID),
    reload: () => buildBrowserOptionalTabAction('reload', tabID),
    click: () => buildBrowserClickAction('click', payload, tabID, locator, timeoutMs, maxAttempts),
    type: () => buildBrowserTypeAction('type', payload, tabID, locator, timeoutMs, maxAttempts),
    press: () => ({ action: 'press', key: assertString(payload.key, 'key'), tabID }),
    scroll: () => ({
      action: 'scroll',
      tabID,
      x: payload.x === undefined ? undefined : assertFiniteNumber(payload.x, 'x'),
      y: payload.y === undefined ? undefined : assertFiniteNumber(payload.y, 'y'),
      top: payload.top === undefined ? undefined : assertFiniteNumber(payload.top, 'top'),
      left: payload.left === undefined ? undefined : assertFiniteNumber(payload.left, 'left'),
      behavior: assertScrollBehavior(payload.behavior),
    }),
    extract_text: () =>
      buildBrowserExtractTextAction('extract_text', payload, tabID, locator, timeoutMs, maxAttempts),
    exists: () => ({
      action: 'exists',
      selector: assertOptionalString(payload.selector, 'selector'),
      tabID,
      locator,
      timeoutMs,
    }),
    visible: () => ({
      action: 'visible',
      selector: assertOptionalString(payload.selector, 'selector'),
      tabID,
      locator,
      timeoutMs,
    }),
    wait_for: () => buildBrowserWaitForAction('wait_for', payload, tabID, locator, timeoutMs),
    wait_for_navigation: () => ({ action: 'wait_for_navigation', tabID, timeoutMs }),
    wait_for_idle: () => buildBrowserWaitForIdleAction('wait_for_idle', tabID, timeoutMs, payload),
    screenshot: () => buildBrowserScreenshotAction('screenshot', payload, tabID),
  }
  const handler = actionHandlers[action]
  if (handler) {
    return handler()
  }
  throw new Error(`Unsupported browser action: ${action}`)
}
