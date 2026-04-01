import { useEffect, useRef, type MutableRefObject } from 'react'
import type { SessionMessageBundle } from '@shared/ipc'
import { BROWSER_MODE_TOOLS_POLICY } from '../lib/browser-tool-guardrails'
import { getBrowserGuardrailViolation } from './browser-agent-bridge-guardrails'

const BROWSER_ACTION_TAG_PATTERN = /<orxa_browser_action>\s*([\s\S]*?)\s*<\/orxa_browser_action>/gi

export const ORXA_BROWSER_RESULT_PREFIX = '[ORXA_BROWSER_RESULT]'

export type BrowserControlOwner = 'agent' | 'human'

type BrowserActionEnvelope = {
  id: string
  action: string
  args: Record<string, unknown>
}

type BrowserAgentRequest = {
  action: string
  [key: string]: unknown
}

type BrowserMachineResult = {
  id: string
  action: string
  ok: boolean
  data?: unknown
  error?: string
  blockedReason?: string
}

type BrowserBridgeAPI = {
  performAgentAction?: (action: BrowserAgentRequest) => Promise<unknown>
}

type PromptAttachment = {
  url: string
  mime: string
  filename?: string
}

function readBrowserBridge() {
  return (window.orxa as unknown as { browser?: BrowserBridgeAPI }).browser
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function buildActionRequestWithContext(
  envelope: BrowserActionEnvelope,
  context: {
    workspace?: string | null
    sessionID?: string | null
  }
): BrowserAgentRequest {
  const request: BrowserAgentRequest = {
    action: envelope.action,
    ...envelope.args,
  }
  if (!isNonEmptyString(request.actionID)) {
    request.actionID = envelope.id
  }
  if (isNonEmptyString(context.workspace) && !isNonEmptyString(request.workspace)) {
    request.workspace = context.workspace
  }
  if (isNonEmptyString(context.sessionID) && !isNonEmptyString(request.sessionID)) {
    request.sessionID = context.sessionID
  }
  return request
}

function screenshotAttachmentFromOutput(output: unknown): PromptAttachment | undefined {
  if (!isRecord(output)) {
    return undefined
  }
  const outputData = isRecord(output.data) ? output.data : undefined
  const fileUrl =
    typeof outputData?.fileUrl === 'string'
      ? outputData.fileUrl
      : typeof output.fileUrl === 'string'
        ? output.fileUrl
        : undefined
  const mime =
    typeof outputData?.mime === 'string'
      ? outputData.mime
      : typeof output.mime === 'string'
        ? output.mime
        : undefined
  if (!fileUrl || !mime) {
    return undefined
  }
  const filename =
    typeof outputData?.filename === 'string'
      ? outputData.filename
      : typeof output.filename === 'string'
        ? output.filename
        : undefined
  return {
    url: fileUrl,
    mime,
    ...(filename ? { filename } : {}),
  }
}

async function sendBrowserAgentResult({
  activeProjectDir,
  activeSessionID,
  browserModeEnabled,
  result,
  attachments,
}: {
  activeProjectDir: string
  activeSessionID: string
  browserModeEnabled: boolean
  result: BrowserMachineResult
  attachments?: PromptAttachment[]
}) {
  await window.orxa.opencode.sendPrompt({
    directory: activeProjectDir,
    sessionID: activeSessionID,
    text: toMachineResultText(result),
    attachments,
    promptSource: 'machine',
    tools: browserModeEnabled ? BROWSER_MODE_TOOLS_POLICY : undefined,
  })
}

function parseActionPayload(raw: string): BrowserActionEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const envelope = parsed as Record<string, unknown>
    if (typeof envelope.id !== 'string' || envelope.id.trim().length === 0) {
      return null
    }
    if (typeof envelope.action !== 'string' || envelope.action.trim().length === 0) {
      return null
    }
    const args = envelope.args
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
      return null
    }
    return {
      id: envelope.id.trim(),
      action: envelope.action.trim(),
      args: (args as Record<string, unknown> | undefined) ?? {},
    }
  } catch {
    return null
  }
}

export function parseBrowserActionsFromText(text: string) {
  const actions: BrowserActionEnvelope[] = []
  let match: RegExpExecArray | null
  BROWSER_ACTION_TAG_PATTERN.lastIndex = 0
  while ((match = BROWSER_ACTION_TAG_PATTERN.exec(text)) !== null) {
    const payload = match[1]?.trim() ?? ''
    if (!payload) {
      continue
    }
    const action = parseActionPayload(payload)
    if (action) {
      actions.push(action)
    }
  }
  return actions
}

function parseBrowserMachineResultID(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith(ORXA_BROWSER_RESULT_PREFIX)) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed.slice(ORXA_BROWSER_RESULT_PREFIX.length).trim()) as unknown
    if (!isRecord(parsed)) {
      return null
    }
    const id = parsed.id
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null
  } catch {
    return null
  }
}

function collectAssistantBrowserActions(messages: SessionMessageBundle[]) {
  const actions: BrowserActionEnvelope[] = []
  for (const bundle of messages) {
    if (bundle.info.role !== 'assistant') {
      continue
    }
    for (const part of bundle.parts) {
      if (part.type !== 'text') {
        continue
      }
      actions.push(...parseBrowserActionsFromText(part.text))
    }
  }
  return actions
}

function collectCompletedBrowserActionIDs(messages: SessionMessageBundle[]) {
  const ids = new Set<string>()
  for (const bundle of messages) {
    if (bundle.info.role !== 'user') {
      continue
    }
    for (const part of bundle.parts) {
      if (part.type !== 'text') {
        continue
      }
      const id = parseBrowserMachineResultID(part.text)
      if (id) {
        ids.add(id)
      }
    }
  }
  return ids
}

function toMachineResultText(result: BrowserMachineResult) {
  return `${ORXA_BROWSER_RESULT_PREFIX}${JSON.stringify(result)}`
}

async function runBrowserAgentAction({
  envelope,
  activeProjectDir,
  activeSessionID,
  browserModeEnabled,
  controlOwner,
  processed,
  running,
  onActionStartRef,
  onStatusRef,
  onGuardrailViolationRef,
}: {
  envelope: BrowserActionEnvelope
  activeProjectDir: string
  activeSessionID: string
  browserModeEnabled: boolean
  controlOwner: BrowserControlOwner
  processed: Set<string>
  running: Set<string>
  onActionStartRef: MutableRefObject<UseBrowserAgentBridgeOptions['onActionStart']>
  onStatusRef: MutableRefObject<UseBrowserAgentBridgeOptions['onStatus']>
  onGuardrailViolationRef: MutableRefObject<UseBrowserAgentBridgeOptions['onGuardrailViolation']>
}) {
  const request = buildActionRequestWithContext(envelope, {
    workspace: activeProjectDir,
    sessionID: activeSessionID,
  })

  let result: BrowserMachineResult
  let resultAttachments: PromptAttachment[] | undefined
  if (!browserModeEnabled) {
    onGuardrailViolationRef.current?.(
      'Blocked browser action because Browser Mode is disabled for this session.'
    )
    processed.add(envelope.id)
    running.delete(envelope.id)
    return
  }
  if (controlOwner === 'human') {
    onGuardrailViolationRef.current?.(
      'Blocked browser action because browser control is currently owned by the human.'
    )
    processed.add(envelope.id)
    running.delete(envelope.id)
    return
  }

  const browser = readBrowserBridge()
  if (!browser?.performAgentAction) {
    result = {
      id: envelope.id,
      action: envelope.action,
      ok: false,
      blockedReason: 'browser_bridge_unavailable',
      error: 'Browser bridge is unavailable.',
    }
  } else {
    onActionStartRef.current?.(envelope)
    try {
      const output = await browser.performAgentAction(request)
      const screenshotAttachment =
        envelope.action === 'screenshot' ? screenshotAttachmentFromOutput(output) : undefined
      resultAttachments = screenshotAttachment ? [screenshotAttachment] : undefined
      const actionOk =
        output && typeof output === 'object' && 'ok' in output
          ? Boolean((output as { ok?: unknown }).ok)
          : true
      result = {
        id: envelope.id,
        action: envelope.action,
        ok: actionOk,
        data: output,
      }
    } catch (error) {
      result = {
        id: envelope.id,
        action: envelope.action,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  try {
    await sendBrowserAgentResult({
      activeProjectDir,
      activeSessionID,
      browserModeEnabled,
      result,
      attachments: resultAttachments,
    })
  } catch (error) {
    onStatusRef.current?.(
      `Failed to send browser machine result: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    processed.add(envelope.id)
    running.delete(envelope.id)
  }
}

async function processBrowserAgentActions({
  activeProjectDir,
  activeSessionID,
  actions,
  browserModeEnabled,
  controlOwner,
  processed,
  running,
  onActionStartRef,
  onStatusRef,
  onGuardrailViolationRef,
  cancelledRef,
}: {
  activeProjectDir: string
  activeSessionID: string
  actions: BrowserActionEnvelope[]
  browserModeEnabled: boolean
  controlOwner: BrowserControlOwner
  processed: Set<string>
  running: Set<string>
  onActionStartRef: MutableRefObject<UseBrowserAgentBridgeOptions['onActionStart']>
  onStatusRef: MutableRefObject<UseBrowserAgentBridgeOptions['onStatus']>
  onGuardrailViolationRef: MutableRefObject<UseBrowserAgentBridgeOptions['onGuardrailViolation']>
  cancelledRef: MutableRefObject<boolean>
}) {
  for (const envelope of actions) {
    if (cancelledRef.current) {
      return
    }
    if (processed.has(envelope.id) || running.has(envelope.id)) {
      continue
    }
    running.add(envelope.id)
    await runBrowserAgentAction({
      envelope,
      activeProjectDir,
      activeSessionID,
      browserModeEnabled,
      controlOwner,
      processed,
      running,
      onActionStartRef,
      onStatusRef,
      onGuardrailViolationRef,
    })
  }
}

function useBrowserAgentActionProcessing(
  options: UseBrowserAgentBridgeOptions
) {
  const {
    activeProjectDir,
    activeSessionID,
    messages,
    browserModeEnabled,
    controlOwner,
    automationHalted,
  } = options
  const processedBySessionRef = useRef<Record<string, Set<string>>>({})
  const runningBySessionRef = useRef<Record<string, Set<string>>>({})
  const onActionStartRef = useRef(options.onActionStart)
  const onStatusRef = useRef(options.onStatus)
  const onGuardrailViolationRef = useRef(options.onGuardrailViolation)

  useEffect(() => {
    onActionStartRef.current = options.onActionStart
    onStatusRef.current = options.onStatus
    onGuardrailViolationRef.current = options.onGuardrailViolation
  }, [options.onActionStart, options.onStatus, options.onGuardrailViolation])

  useEffect(() => {
    const directory = activeProjectDir
    const sessionID = activeSessionID
    if (!directory || !sessionID) {
      return
    }

    const actions = collectAssistantBrowserActions(messages)
    if (actions.length === 0) {
      return
    }

    const sessionKey = `${directory}::${sessionID}`
    const processed = processedBySessionRef.current[sessionKey] ?? new Set<string>()
    processedBySessionRef.current[sessionKey] = processed
    const running = runningBySessionRef.current[sessionKey] ?? new Set<string>()
    runningBySessionRef.current[sessionKey] = running
    const completed = collectCompletedBrowserActionIDs(messages)
    for (const id of completed) {
      processed.add(id)
    }
    const cancelledRef = { current: false }

    if (automationHalted) {
      for (const action of actions) {
        running.delete(action.id)
      }
      return
    }

    void processBrowserAgentActions({
      activeProjectDir: directory,
      activeSessionID: sessionID,
      actions,
      browserModeEnabled,
      controlOwner,
      processed,
      running,
      onActionStartRef,
      onStatusRef,
      onGuardrailViolationRef,
      cancelledRef,
    })
    return () => {
      cancelledRef.current = true
    }
  }, [
    activeProjectDir,
    activeSessionID,
    automationHalted,
    browserModeEnabled,
    controlOwner,
    messages,
    onActionStartRef,
    onGuardrailViolationRef,
    onStatusRef,
    processedBySessionRef,
    runningBySessionRef,
  ])
}

function useBrowserAgentGuardrails(
  options: UseBrowserAgentBridgeOptions
) {
  const { activeProjectDir, activeSessionID, messages, browserModeEnabled, controlOwner, automationHalted } =
    options
  const guardrailSeenBySessionRef = useRef<Record<string, Set<string>>>({})
  const onGuardrailViolationRef = useRef(options.onGuardrailViolation)

  useEffect(() => {
    onGuardrailViolationRef.current = options.onGuardrailViolation
  }, [options.onGuardrailViolation])

  useEffect(() => {
    if (!browserModeEnabled || controlOwner !== 'agent' || automationHalted) {
      return
    }
    const directory = activeProjectDir
    const sessionID = activeSessionID
    if (!directory || !sessionID) {
      return
    }

    const sessionKey = `${directory}::${sessionID}`
    const seen = guardrailSeenBySessionRef.current[sessionKey] ?? new Set<string>()
    guardrailSeenBySessionRef.current[sessionKey] = seen
    const hasOrxaAction = collectAssistantBrowserActions(messages).length > 0

    for (const bundle of messages) {
      const violation = getBrowserGuardrailViolation(bundle, hasOrxaAction, seen)
      if (violation) {
        onGuardrailViolationRef.current?.(violation)
        return
      }
    }
  }, [
    activeProjectDir,
    activeSessionID,
    automationHalted,
    browserModeEnabled,
    controlOwner,
    messages,
    guardrailSeenBySessionRef,
    onGuardrailViolationRef,
  ])
}

type UseBrowserAgentBridgeOptions = {
  activeProjectDir: string | null | undefined
  activeSessionID: string | null | undefined
  messages: SessionMessageBundle[]
  browserModeEnabled: boolean
  controlOwner: BrowserControlOwner
  automationHalted?: boolean
  onActionStart?: (action: BrowserActionEnvelope) => void
  onStatus?: (message: string) => void
  onGuardrailViolation?: (message: string) => void
}

export function useBrowserAgentBridge(options: UseBrowserAgentBridgeOptions) {
  useBrowserAgentActionProcessing(options)
  useBrowserAgentGuardrails(options)
}
