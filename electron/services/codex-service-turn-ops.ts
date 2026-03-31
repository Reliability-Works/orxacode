import type {
  CodexAttachment,
  CodexCollaborationMode,
  CodexModelEntry,
} from '@shared/ipc'
import { buildTurnInput, collectDescendantThreadIds, getActiveTurnIdFromThread, parseModeListResponse, parseModelListResponse, asString } from './codex-service-parsers'
import { findBindingForThread, seedBindingFromLegacyThread, upsertBindingForThread } from './codex-service-thread-bindings'
import type { CodexServiceThreadOpsContext } from './codex-service-thread-ops'

export function buildCollaborationModePayload(
  context: CodexServiceThreadOpsContext,
  params: {
    model?: string
    effort?: string
    collaborationMode: string
    threadId: string
  }
): { mode: string; settings: Record<string, unknown> } {
  const modeId = params.collaborationMode
  const modeMeta = context.collaborationModes.find(mode => mode.id === modeId)
  const threadSettings = context.threadSettings.get(params.threadId)
  const modelCandidates = [
    params.model,
    modeMeta?.model?.trim(),
    threadSettings?.model,
    context.models.find(entry => entry.isDefault)?.model,
  ]
  const model = modelCandidates.find(value => value != null && value !== '') ?? ''
  const effortCandidates = [
    params.effort,
    modeMeta?.reasoningEffort?.trim(),
    threadSettings?.reasoningEffort,
  ]
  const reasoningEffort = effortCandidates.find(value => value != null && value !== '') ?? null
  return {
    mode: modeMeta?.mode || modeId,
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: modeMeta?.developerInstructions || null,
    },
  }
}

export async function startCodexTurn(
  context: CodexServiceThreadOpsContext,
  params: {
    threadId: string
    prompt: string
    cwd?: string
    model?: string
    effort?: string
    collaborationMode?: string
    attachments?: CodexAttachment[]
  }
): Promise<void> {
  if (!findBindingForThread(context.providerSessionDirectory, params.threadId)) {
    seedBindingFromLegacyThread(context.providerSessionDirectory, params.threadId, params.cwd)
  }
  if (context.process && !context.hydratedThreadIds.has(params.threadId)) {
    await context.resumeThread(params.threadId)
  }
  const input = buildTurnInput(params.prompt, params.attachments)
  const bindingInput = {
    cwd: params.cwd,
    model: params.model,
    reasoningEffort: params.effort ?? null,
    collaborationMode: params.collaborationMode,
  }
  upsertBindingForThread(context.providerSessionDirectory, params.threadId, {
    ...bindingInput,
    status: 'starting',
  })
  const turnParams: Record<string, unknown> = { threadId: params.threadId, input }
  if (params.model) turnParams.model = params.model
  if (params.effort) turnParams.effort = params.effort
  if (params.collaborationMode) {
    turnParams.collaborationMode = buildCollaborationModePayload(context, {
      model: params.model,
      effort: params.effort,
      collaborationMode: params.collaborationMode,
      threadId: params.threadId,
    })
  }
  await context.request('turn/start', turnParams)
  upsertBindingForThread(context.providerSessionDirectory, params.threadId, {
    ...bindingInput,
    status: 'running',
  })
}

export async function steerCodexTurn(
  context: CodexServiceThreadOpsContext,
  threadId: string,
  turnId: string,
  prompt: string
): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedTurnId = turnId.trim()
  const normalizedPrompt = prompt.trim()
  if (!normalizedThreadId) throw new Error('threadId is required')
  if (!normalizedTurnId) throw new Error('turnId is required')
  if (!normalizedPrompt) throw new Error('prompt is required')
  await context.request('turn/steer', {
    threadId: normalizedThreadId,
    expectedTurnId: normalizedTurnId,
    input: [{ type: 'text', text: normalizedPrompt, text_elements: [] }],
  })
}

export async function interruptCodexTurn(
  context: CodexServiceThreadOpsContext,
  threadId: string,
  turnId: string
): Promise<void> {
  const params: Record<string, string> = { threadId }
  if (turnId) params.turnId = turnId
  context.sendNotification('turn/interrupt', params)
  try {
    await context.request('turn/interrupt', params)
  } catch {
    // Notification-only servers may not respond.
  }
}

export async function interruptCodexThreadTree(
  context: CodexServiceThreadOpsContext,
  rootThreadId: string,
  rootTurnId?: string
): Promise<void> {
  const normalizedRootThreadId = rootThreadId.trim()
  if (!normalizedRootThreadId) throw new Error('threadId is required')
  await context.ensureConnected()
  const threadRecords = await context.listThreadRecords()
  const threadMap = new Map(threadRecords.map(thread => [asString(thread.id).trim(), thread]))
  const descendants = collectDescendantThreadIds(normalizedRootThreadId, threadRecords)
  for (const threadId of [normalizedRootThreadId, ...descendants]) {
    const threadRecord = threadMap.get(threadId)
    const turnId =
      threadId === normalizedRootThreadId
        ? rootTurnId?.trim() || getActiveTurnIdFromThread(threadRecord ?? {})
        : getActiveTurnIdFromThread(threadRecord ?? {})
    await interruptCodexTurn(context, threadId, turnId ?? 'pending')
  }
}

export async function listCodexModels(
  context: CodexServiceThreadOpsContext
): Promise<CodexModelEntry[]> {
  if (!context.process) return context.models
  try {
    const models = parseModelListResponse(await context.request('model/list', {}))
    context.setModels(models)
    return models
  } catch {
    return context.models
  }
}

export async function listCodexCollaborationModes(
  context: CodexServiceThreadOpsContext
): Promise<CodexCollaborationMode[]> {
  if (!context.process) return context.collaborationModes
  try {
    const modes = parseModeListResponse(await context.request('collaborationMode/list', {}))
    context.setCollaborationModes(modes)
    return modes
  } catch {
    return context.collaborationModes
  }
}

export async function respondToCodexApproval(
  context: CodexServiceThreadOpsContext,
  requestId: number,
  decision: string
): Promise<void> {
  context.sendResponse(requestId, { decision })
}

export async function respondToCodexUserInput(
  context: CodexServiceThreadOpsContext,
  requestId: number,
  answers: Record<string, { answers: string[] }>
): Promise<void> {
  context.sendResponse(requestId, { answers })
}
