import type { WebContents } from 'electron'
import type { BrowserAgentActionRequest, BrowserAgentActionResult } from '../../shared/ipc'
import {
  buildInteractionScript,
  buildInspectDisableScript,
  buildInspectEnableScript,
  buildInspectGetAnnotationScript,
  buildPressScript,
  buildScrollScript,
} from './browser-dom-scripts'
import {
  clampAttempts,
  clampJpegQuality,
  clampTimeoutMs,
  normalizeErrorMessage,
  toLocatorFromRequest,
  toRectFromBounds,
} from './browser-controller-utils'
import type { BrowserControllerActionContext } from './browser-controller-types'
import {
  runDomAction,
  runDomActionWithRetry,
  waitForIdle,
  waitForLocatorState,
  waitForNavigation,
} from './browser-dom-runner'

type ActionOf<A extends BrowserAgentActionRequest['action']> = Extract<
  BrowserAgentActionRequest,
  { action: A }
>
type ActionHandlerResult = { tabID?: string; data?: Record<string, unknown> }
type ActionHandlerFn = (
  controller: BrowserControllerActionContext,
  request: BrowserAgentActionRequest
) => Promise<ActionHandlerResult> | ActionHandlerResult

// ---------------------------------------------------------------------------
// Action handlers – one per BrowserAgentActionRequest variant
// ---------------------------------------------------------------------------

async function handleOpenTab(
  controller: BrowserControllerActionContext,
  request: ActionOf<'open_tab'>
): Promise<ActionHandlerResult> {
  await controller.openTab(request.url, request.activate ?? true)
  return { tabID: controller.getState().activeTabID }
}

function handleCloseTab(
  controller: BrowserControllerActionContext,
  request: ActionOf<'close_tab'>
): ActionHandlerResult {
  controller.closeTab(request.tabID)
  return { tabID: request.tabID }
}

function handleSwitchTab(
  controller: BrowserControllerActionContext,
  request: ActionOf<'switch_tab'>
): ActionHandlerResult {
  controller.switchTab(request.tabID)
  return { tabID: request.tabID }
}

async function handleNavigate(
  controller: BrowserControllerActionContext,
  request: ActionOf<'navigate'>
): Promise<ActionHandlerResult> {
  await controller.navigate(request.url, request.tabID)
  return { tabID: request.tabID ?? controller.getState().activeTabID }
}

function handleBack(
  controller: BrowserControllerActionContext,
  request: ActionOf<'back'>
): ActionHandlerResult {
  controller.back(request.tabID)
  return { tabID: request.tabID ?? controller.getState().activeTabID }
}

function handleForward(
  controller: BrowserControllerActionContext,
  request: ActionOf<'forward'>
): ActionHandlerResult {
  controller.forward(request.tabID)
  return { tabID: request.tabID ?? controller.getState().activeTabID }
}

function handleReload(
  controller: BrowserControllerActionContext,
  request: ActionOf<'reload'>
): ActionHandlerResult {
  controller.reload(request.tabID)
  return { tabID: request.tabID ?? controller.getState().activeTabID }
}

async function handleClick(
  controller: BrowserControllerActionContext,
  request: ActionOf<'click'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const attempts = clampAttempts(request.maxAttempts)
  const outcome = await runDomActionWithRetry(
    record.view.webContents,
    buildInteractionScript('click', locator, { timeoutMs }),
    'click',
    attempts
  )
  if (request.waitForNavigation) {
    await waitForNavigation(record, timeoutMs)
  }
  return {
    tabID: record.id,
    data: {
      ...outcome,
      locator,
      attempts,
      timeoutMs,
      waitForNavigation: request.waitForNavigation ?? false,
    },
  }
}

async function handleType(
  controller: BrowserControllerActionContext,
  request: ActionOf<'type'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const attempts = clampAttempts(request.maxAttempts)
  const outcome = await runDomActionWithRetry(
    record.view.webContents,
    buildInteractionScript('type', locator, {
      timeoutMs,
      text: request.text,
      clear: request.clear ?? true,
    }),
    'type',
    attempts
  )
  if (request.submit) {
    await runDomAction(record.view.webContents, buildPressScript('Enter'), 'press')
  }
  return {
    tabID: record.id,
    data: {
      ...outcome,
      locator,
      typed: request.text.length,
      submitted: request.submit ?? false,
      attempts,
      timeoutMs,
    },
  }
}

async function handlePress(
  controller: BrowserControllerActionContext,
  request: ActionOf<'press'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  await runDomAction(record.view.webContents, buildPressScript(request.key), 'press')
  return { tabID: record.id, data: { key: request.key } }
}

async function handleScroll(
  controller: BrowserControllerActionContext,
  request: ActionOf<'scroll'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  await runDomAction(
    record.view.webContents,
    buildScrollScript(request.x, request.y, request.top, request.left, request.behavior),
    'scroll'
  )
  return {
    tabID: record.id,
    data: {
      x: request.x,
      y: request.y,
      top: request.top,
      left: request.left,
      behavior: request.behavior,
    },
  }
}

async function handleExtractText(
  controller: BrowserControllerActionContext,
  request: ActionOf<'extract_text'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const attempts = clampAttempts(request.maxAttempts)
  const outcome = await runDomActionWithRetry(
    record.view.webContents,
    buildInteractionScript('extract_text', locator, { maxLength: request.maxLength, timeoutMs }),
    'extract_text',
    attempts
  )
  const extractedText = outcome['text']
  const selectorUsed = outcome['selectorUsed']
  const strategyUsed = outcome['strategyUsed']
  return {
    tabID: record.id,
    data: {
      text: typeof extractedText === 'string' ? extractedText : '',
      locator,
      selectorUsed: typeof selectorUsed === 'string' ? selectorUsed : undefined,
      strategyUsed: typeof strategyUsed === 'string' ? strategyUsed : undefined,
      attempts,
      timeoutMs,
    },
  }
}

async function handleExists(
  controller: BrowserControllerActionContext,
  request: ActionOf<'exists'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const outcome = await runDomAction(
    record.view.webContents,
    buildInteractionScript('exists', locator, { timeoutMs }),
    'exists'
  )
  return {
    tabID: record.id,
    data: {
      exists: Boolean(outcome.found),
      locator,
      selectorUsed: outcome.selectorUsed,
      strategyUsed: outcome.strategyUsed,
      timeoutMs,
    },
  }
}

async function handleVisible(
  controller: BrowserControllerActionContext,
  request: ActionOf<'visible'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const outcome = await runDomAction(
    record.view.webContents,
    buildInteractionScript('visible', locator, { timeoutMs }),
    'visible'
  )
  return {
    tabID: record.id,
    data: {
      visible: Boolean(outcome.visible),
      locator,
      selectorUsed: outcome.selectorUsed,
      strategyUsed: outcome.strategyUsed,
      timeoutMs,
    },
  }
}

async function handleWaitFor(
  controller: BrowserControllerActionContext,
  request: ActionOf<'wait_for'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const locator = toLocatorFromRequest(request)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const state = request.state ?? 'visible'
  const outcome = await waitForLocatorState(record.view.webContents, locator, state, timeoutMs)
  return {
    tabID: record.id,
    data: { state, locator, timeoutMs, ...outcome },
  }
}

async function handleWaitForNavigation(
  controller: BrowserControllerActionContext,
  request: ActionOf<'wait_for_navigation'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  await waitForNavigation(record, timeoutMs)
  return { tabID: record.id, data: { timeoutMs } }
}

async function handleWaitForIdle(
  controller: BrowserControllerActionContext,
  request: ActionOf<'wait_for_idle'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const timeoutMs = clampTimeoutMs(request.timeoutMs)
  const idleMs = Math.max(100, Math.min(30_000, Math.floor(request.idleMs ?? 1_000)))
  await waitForIdle(record, idleMs, timeoutMs)
  return { tabID: record.id, data: { idleMs, timeoutMs } }
}

async function handleScreenshot(
  controller: BrowserControllerActionContext,
  request: ActionOf<'screenshot'>
): Promise<ActionHandlerResult> {
  const record = controller.requireTab(request.tabID)
  const image = await record.view.webContents.capturePage(toRectFromBounds(request.bounds))
  const format = request.format === 'jpeg' ? 'jpeg' : 'png'
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  const buffer =
    format === 'jpeg' ? image.toJPEG(clampJpegQuality(request.quality)) : image.toPNG()
  const workspace =
    typeof request.workspace === 'string' && request.workspace.trim().length > 0
      ? request.workspace
      : 'global'
  const sessionID =
    typeof request.sessionID === 'string' && request.sessionID.trim().length > 0
      ? request.sessionID
      : 'browser'
  const tabUrl = record.view.webContents.getURL()
  const tabTitle = controller.titleForRecord(record)
  const artifact = await controller.artifactStore.writeImageArtifact({
    workspace,
    sessionID,
    kind: 'browser.screenshot',
    mime,
    buffer,
    width: image.getSize().width,
    height: image.getSize().height,
    title: tabTitle,
    url: tabUrl,
    actionID: request.actionID,
    metadata: { tabID: record.id },
  })
  controller.emit({ type: 'artifact.created', payload: artifact })
  return {
    tabID: record.id,
    data: {
      artifactID: artifact.id,
      artifactPath: artifact.artifactPath,
      fileUrl: artifact.fileUrl,
      mime: artifact.mime,
      width: artifact.width,
      height: artifact.height,
    },
  }
}

// ---------------------------------------------------------------------------
// Dispatch map & exported entry points
// ---------------------------------------------------------------------------

const actionHandlers: Record<BrowserAgentActionRequest['action'], ActionHandlerFn> = {
  open_tab: handleOpenTab as ActionHandlerFn,
  close_tab: handleCloseTab as ActionHandlerFn,
  switch_tab: handleSwitchTab as ActionHandlerFn,
  navigate: handleNavigate as ActionHandlerFn,
  back: handleBack as ActionHandlerFn,
  forward: handleForward as ActionHandlerFn,
  reload: handleReload as ActionHandlerFn,
  click: handleClick as ActionHandlerFn,
  type: handleType as ActionHandlerFn,
  press: handlePress as ActionHandlerFn,
  scroll: handleScroll as ActionHandlerFn,
  extract_text: handleExtractText as ActionHandlerFn,
  exists: handleExists as ActionHandlerFn,
  visible: handleVisible as ActionHandlerFn,
  wait_for: handleWaitFor as ActionHandlerFn,
  wait_for_navigation: handleWaitForNavigation as ActionHandlerFn,
  wait_for_idle: handleWaitForIdle as ActionHandlerFn,
  screenshot: handleScreenshot as ActionHandlerFn,
}

export async function performBrowserAgentAction(
  controller: BrowserControllerActionContext,
  request: BrowserAgentActionRequest
): Promise<BrowserAgentActionResult> {
  const initialTabID = 'tabID' in request ? request.tabID : undefined
  try {
    const result = await actionHandlers[request.action](controller, request)
    const tabID = result.tabID ?? initialTabID
    const success: BrowserAgentActionResult = {
      action: request.action,
      ok: true,
      state: controller.getState(),
      tabID,
      data: result.data,
    }
    controller.emit({ type: 'browser.agent.action', payload: success })
    return success
  } catch (error) {
    const failure: BrowserAgentActionResult = {
      action: request.action,
      ok: false,
      state: controller.getState(),
      tabID: initialTabID,
      error: normalizeErrorMessage(error),
    }
    controller.emit({ type: 'browser.agent.action', payload: failure })
    return failure
  }
}

function getActiveWebContents(controller: BrowserControllerActionContext): WebContents | null {
  return controller.getActiveWebContents()
}

export async function enableBrowserInspect(
  controller: BrowserControllerActionContext,
  onAnnotation: (annotation: unknown) => void
): Promise<void> {
  const wc = getActiveWebContents(controller)
  if (!wc) throw new Error('No active tab')
  await wc.executeJavaScript(buildInspectEnableScript(), true)
  controller.inspectEventCallback = onAnnotation
  controller.inspectPollTimer = setInterval(async () => {
    try {
      const activeWc = getActiveWebContents(controller)
      if (!activeWc || activeWc.isDestroyed()) {
        controller.inspectPollTimer = null
        controller.inspectEventCallback = null
        return
      }
      const annotation = await activeWc.executeJavaScript(
        buildInspectGetAnnotationScript(),
        true
      )
      if (annotation && controller.inspectEventCallback) {
        controller.inspectEventCallback(annotation)
      }
    } catch {
      // Tab may have navigated or been destroyed — ignore
    }
  }, 150)
}

export async function disableBrowserInspect(
  controller: BrowserControllerActionContext
): Promise<void> {
  if (controller.inspectPollTimer) {
    clearInterval(controller.inspectPollTimer)
    controller.inspectPollTimer = null
  }
  controller.inspectEventCallback = null
  try {
    const wc = getActiveWebContents(controller)
    if (wc && !wc.isDestroyed()) {
      await wc.executeJavaScript(buildInspectDisableScript(), true)
    }
  } catch {
    // Ignore — tab may already be gone
  }
}
