import type { ChildProcess } from 'node:child_process'
import type {
  CodexCollaborationMode,
  CodexModelEntry,
  CodexNotification,
  CodexRunMetadata,
  CodexThread,
  CodexThreadRuntime,
} from '@shared/ipc'
import type { ProviderSessionDirectory } from './provider-session-directory'
import {
  asRecord,
  asString,
  buildRunMetadataPrompt,
  cleanRunMetadataPrompt,
  collectDescendantThreadIds,
  extractThreadIdFromResult,
  getParentThreadIdFromThread,
  isMissingCodexThreadArchiveError,
  parseRunMetadataValue,
  REQUEST_TIMEOUT_MS,
} from './codex-service-parsers'
import {
  findBindingForThread,
  upsertBindingForThread,
} from './codex-service-thread-bindings'
import { startCodexTurn } from './codex-service-turn-ops'

type ThreadSettings = { model?: string; reasoningEffort?: string | null }

export type CodexServiceThreadOpsContext = {
  process: ChildProcess | null
  providerSessionDirectory: ProviderSessionDirectory | null
  models: CodexModelEntry[]
  setModels: (models: CodexModelEntry[]) => void
  collaborationModes: CodexCollaborationMode[]
  setCollaborationModes: (modes: CodexCollaborationMode[]) => void
  threadSettings: Map<string, ThreadSettings>
  hydratedThreadIds: Set<string>
  request: (method: string, params: unknown) => Promise<unknown>
  ensureConnected: (cwd?: string) => Promise<void>
  sendNotification: (method: string, params: unknown) => void
  sendResponse: (id: number, result: unknown) => void
  listThreadRecords: (
    params?: { cursor?: string | null; limit?: number; archived?: boolean }
  ) => Promise<Record<string, unknown>[]>
  resumeThread: (threadId: string) => Promise<Record<string, unknown>>
  subscribeHiddenThread: (
    threadId: string,
    listener: (notification: CodexNotification) => void
  ) => () => void
  archiveHiddenThread: (threadId: string) => Promise<void>
  cleanupThreadMappings: (threadId: string) => void
}

export async function startCodexThread(
  context: CodexServiceThreadOpsContext,
  params: {
    model?: string
    cwd?: string
    approvalPolicy?: string
    sandbox?: string
    title?: string
  }
): Promise<CodexThread> {
  const threadParams: Record<string, unknown> = {
    sandbox: params.sandbox ?? 'danger-full-access',
    approvalPolicy: params.approvalPolicy ?? 'never',
    experimentalRawEvents: false,
  }
  if (params.model) threadParams.model = params.model
  if (params.cwd) threadParams.cwd = params.cwd

  const result = (await context.request('thread/start', threadParams)) as {
    thread: CodexThread
    model?: string
    reasoningEffort?: string | null
    reasoning_effort?: string | null
  }
  context.threadSettings.set(result.thread.id, {
    model: typeof result.model === 'string' ? result.model : undefined,
    reasoningEffort: asString(result.reasoningEffort ?? result.reasoning_effort).trim() || null,
  })
  context.hydratedThreadIds.add(result.thread.id)
  upsertBindingForThread(context.providerSessionDirectory, result.thread.id, {
    cwd: params.cwd,
    model: typeof result.model === 'string' ? result.model : undefined,
    reasoningEffort: asString(result.reasoningEffort ?? result.reasoning_effort).trim() || null,
    status: 'running',
  })
  return result.thread
}

export async function listCodexThreads(
  context: CodexServiceThreadOpsContext,
  params?: { cursor?: string | null; limit?: number; archived?: boolean }
): Promise<{ threads: CodexThread[]; nextCursor?: string }> {
  const result = (await context.request('thread/list', params ?? {})) as {
    threads: CodexThread[]
    nextCursor?: string
  }
  return result
}

export async function listCodexThreadRecords(
  context: CodexServiceThreadOpsContext,
  params?: { cursor?: string | null; limit?: number; archived?: boolean }
): Promise<Record<string, unknown>[]> {
  const result = (await context.request('thread/list', params ?? {})) as Record<string, unknown>
  const threads = Array.isArray(result.threads) ? result.threads : []
  return threads
    .map(thread => asRecord(thread))
    .filter((thread): thread is Record<string, unknown> => Boolean(thread))
}

export async function getCodexThreadRuntime(
  context: CodexServiceThreadOpsContext,
  threadId: string
): Promise<CodexThreadRuntime> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  await context.ensureConnected()
  const threadRecords = await listCodexThreadRecords(context)
  const threadRecord =
    threadRecords.find(candidate => asString(candidate.id).trim() === normalizedThreadId) ?? null
  if (!threadRecord) {
    return { thread: null, childThreads: [] }
  }
  const childThreads = threadRecords
    .filter(candidate => getParentThreadIdFromThread(candidate) === normalizedThreadId)
    .map(candidate => candidate as unknown as CodexThread)
  return {
    thread: threadRecord as unknown as CodexThread,
    childThreads,
  }
}

export async function resumeCodexThread(
  context: CodexServiceThreadOpsContext,
  threadId: string
): Promise<Record<string, unknown>> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  await context.ensureConnected()
  const result = await context.request('thread/resume', { threadId: normalizedThreadId })
  const record = asRecord(result)
  const resumedThread = asRecord(record?.thread)
  const resumedThreadId =
    asString(resumedThread?.id ?? record?.threadId ?? record?.thread_id).trim() ||
    normalizedThreadId
  const model = asString(record?.model).trim() || undefined
  const reasoningEffort =
    asString(record?.reasoningEffort ?? record?.reasoning_effort).trim() || null
  context.threadSettings.set(resumedThreadId, { model, reasoningEffort })
  context.hydratedThreadIds.add(resumedThreadId)
  upsertBindingForThread(context.providerSessionDirectory, resumedThreadId, {
    model,
    reasoningEffort,
    status: 'running',
  })
  return record ?? {}
}

export async function archiveCodexThread(
  context: CodexServiceThreadOpsContext,
  threadId: string
): Promise<void> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  await context.ensureConnected()
  try {
    await context.request('thread/archive', { threadId: normalizedThreadId })
  } catch (error) {
    if (!isMissingCodexThreadArchiveError(error)) {
      throw error
    }
  }
  const binding = findBindingForThread(context.providerSessionDirectory, normalizedThreadId)
  if (binding) {
    context.providerSessionDirectory?.remove(binding.sessionKey, 'codex')
  }
  context.cleanupThreadMappings(normalizedThreadId)
}

export async function archiveCodexThreadTree(
  context: CodexServiceThreadOpsContext,
  rootThreadId: string
): Promise<void> {
  const normalizedRootThreadId = rootThreadId.trim()
  if (!normalizedRootThreadId) {
    throw new Error('threadId is required')
  }
  await context.ensureConnected()
  const threadRecords = await listCodexThreadRecords(context)
  const descendants = collectDescendantThreadIds(normalizedRootThreadId, threadRecords)
  for (const descendantId of descendants) {
    await archiveCodexThread(context, descendantId)
  }
  await archiveCodexThread(context, normalizedRootThreadId)
}

export async function setCodexThreadName(
  context: CodexServiceThreadOpsContext,
  threadId: string,
  name: string
): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedName = name.replace(/\s+/g, ' ').trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  if (!normalizedName) {
    throw new Error('name is required')
  }
  await context.ensureConnected()
  await context.request('thread/name/set', { threadId: normalizedThreadId, name: normalizedName })
}

export async function generateCodexRunMetadata(
  context: CodexServiceThreadOpsContext,
  cwd: string,
  prompt: string
): Promise<CodexRunMetadata> {
  const cleanedPrompt = cleanRunMetadataPrompt(prompt)
  if (!cleanedPrompt) {
    throw new Error('Prompt is required to generate run metadata')
  }

  await context.ensureConnected(cwd)

  const threadResult = await context.request('thread/start', {
    cwd,
    approvalPolicy: 'never',
  })
  const threadId = extractThreadIdFromResult(threadResult)
  if (!threadId) {
    throw new Error('Failed to resolve background Codex thread ID')
  }

  let responseText = ''
  const unsubscribe = context.subscribeHiddenThread(threadId, notification => {
    if (notification.method === 'item/agentMessage/delta') {
      const delta = asString(notification.params.delta)
      if (delta) {
        responseText += delta
      }
    }
  })

  try {
    await context.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: buildRunMetadataPrompt(cleanedPrompt), text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        release()
        reject(new Error('Timed out generating run metadata'))
      }, REQUEST_TIMEOUT_MS)

      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        release()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      const release = context.subscribeHiddenThread(threadId, notification => {
        if (notification.method === 'turn/completed') {
          finish()
          return
        }
        if (notification.method === 'turn/error') {
          const message =
            asString(asRecord(notification.params)?.error).trim() ||
            'Failed to generate run metadata'
          finish(new Error(message))
        }
      })
    })

    return parseRunMetadataValue(responseText)
  } finally {
    unsubscribe()
    await context.archiveHiddenThread(threadId)
    context.cleanupThreadMappings(threadId)
  }
}

export async function captureCodexAssistantReply(
  context: CodexServiceThreadOpsContext,
  threadId: string,
  prompt: string,
  cwd?: string
): Promise<string> {
  const normalizedThreadId = threadId.trim()
  const normalizedPrompt = prompt.trim()
  if (!normalizedThreadId) {
    throw new Error('threadId is required')
  }
  if (!normalizedPrompt) {
    throw new Error('prompt is required')
  }

  await context.ensureConnected(cwd)

  let responseText = ''
  const releaseDelta = context.subscribeHiddenThread(normalizedThreadId, notification => {
    if (notification.method === 'item/agentMessage/delta') {
      const delta = asString(notification.params.delta)
      if (delta) {
        responseText += delta
      }
    }
  })

  try {
    await startCodexTurn(context, { threadId: normalizedThreadId, prompt: normalizedPrompt, cwd })
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        releaseTurn()
        reject(new Error('Timed out waiting for Codex assistant reply'))
      }, REQUEST_TIMEOUT_MS)

      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        releaseTurn()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      const releaseTurn = context.subscribeHiddenThread(normalizedThreadId, notification => {
        if (notification.method === 'turn/completed') {
          finish()
          return
        }
        if (notification.method === 'turn/error') {
          const message =
            asString(asRecord(notification.params)?.error).trim() ||
            'Failed to capture Codex assistant reply'
          finish(new Error(message))
        }
      })
    })
    return responseText.trim()
  } finally {
    releaseDelta()
  }
}
