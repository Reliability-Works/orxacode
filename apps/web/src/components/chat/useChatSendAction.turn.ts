/**
 * executeSendTurn + helpers extracted from useChatSendAction.
 */

import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderKind,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ThreadId,
} from '@orxa-code/contracts'
import { truncate } from '@orxa-code/shared/String'
import { newCommandId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import type { ComposerImageAttachment } from '../../composerDraftStore'
import type { Thread } from '../../types'
import type { TerminalContextDraft } from '../../lib/terminalContext'
import { formatTerminalContextLabel } from '../../lib/terminalContext'
import { setupProjectScript } from '../../projectScripts'
import { buildTemporaryWorktreeBranchName } from '../ChatView.logic'
import type { RunScriptOptions } from './useChatTerminalActions'
import type {
  CreateWorktreeMutation,
  PersistThreadSettingsForNextTurn,
} from './useChatSendAction.types'

export function buildTitleSeed(
  trimmed: string,
  images: ComposerImageAttachment[],
  terminalContexts: TerminalContextDraft[]
): string {
  if (trimmed) return trimmed
  const firstImage = images[0]
  if (firstImage) return `Image: ${firstImage.name}`
  const firstCtx = terminalContexts[0]
  if (firstCtx) return formatTerminalContextLabel(firstCtx)
  return 'New thread'
}

export async function runSetupScriptIfNeeded(
  activeProject: { scripts: import('@orxa-code/contracts').ProjectScript[] },
  baseBranchForWorktree: string | null,
  nextWorktreePath: string | null,
  isServerThread: boolean,
  createdLocalDraft: boolean,
  runProjectScript: (
    script: { id: string; command: string; name: string },
    opts?: RunScriptOptions
  ) => Promise<void>
): Promise<void> {
  if (!baseBranchForWorktree) return
  const setupScript = setupProjectScript(activeProject.scripts)
  if (!setupScript) return
  if (!isServerThread && !createdLocalDraft) return
  const opts: RunScriptOptions = { worktreePath: nextWorktreePath, rememberAsLastInvoked: false }
  if (nextWorktreePath) opts.cwd = nextWorktreePath
  await runProjectScript(setupScript, opts)
}

export interface SendTurnParams {
  api: NonNullable<ReturnType<typeof readNativeApi>>
  thread: Thread
  project: {
    id: import('@orxa-code/contracts').ProjectId
    cwd: string
    scripts: import('@orxa-code/contracts').ProjectScript[]
    defaultModelSelection?: ModelSelection | null
  }
  threadIdForSend: ThreadId
  isServerThread: boolean
  isLocalDraftThread: boolean
  baseBranchForWorktree: string | null
  imagesSnapshot: ComposerImageAttachment[]
  terminalContextsSnapshot: TerminalContextDraft[]
  trimmed: string
  outgoingText: string
  messageId: import('@orxa-code/contracts').MessageId
  createdAt: string
  turnAttachmentsPromise: Promise<
    Array<{ type: 'image'; name: string; mimeType: string; sizeBytes: number; dataUrl: string }>
  >
  selectedProvider: ProviderKind
  selectedModel: string
  selectedModelSelection: ModelSelection
  runtimeMode: RuntimeMode
  interactionMode: ProviderInteractionMode
  createWorktreeMutation: CreateWorktreeMutation
  beginLocalDispatch: (opts?: { preparingWorktree?: boolean }) => void
  setStoreThreadBranch: (id: ThreadId, branch: string, path: string) => void
  persistThreadSettings: PersistThreadSettingsForNextTurn
  runProjectScript: (
    script: { id: string; command: string; name: string },
    opts?: RunScriptOptions
  ) => Promise<void>
}

async function prepareWorktreeForTurn(
  params: SendTurnParams
): Promise<{ nextBranch: string | null; nextWorktreePath: string | null }> {
  let nextBranch = params.thread.branch
  let nextWorktreePath = params.thread.worktreePath
  if (!params.baseBranchForWorktree) return { nextBranch, nextWorktreePath }
  params.beginLocalDispatch({ preparingWorktree: true })
  const newBranch = buildTemporaryWorktreeBranchName()
  const result = await params.createWorktreeMutation.mutateAsync({
    cwd: params.project.cwd,
    branch: params.baseBranchForWorktree,
    newBranch,
  })
  nextBranch = result.worktree.branch
  nextWorktreePath = result.worktree.path
  if (params.isServerThread) {
    await params.api.orchestration.dispatchCommand({
      type: 'thread.meta.update',
      commandId: newCommandId(),
      threadId: params.threadIdForSend,
      branch: result.worktree.branch,
      worktreePath: result.worktree.path,
    })
    params.setStoreThreadBranch(
      params.threadIdForSend,
      result.worktree.branch,
      result.worktree.path
    )
  }
  return { nextBranch, nextWorktreePath }
}

async function createLocalDraftThreadIfNeeded(
  params: SendTurnParams,
  nextBranch: string | null,
  nextWorktreePath: string | null,
  title: string
): Promise<boolean> {
  if (!params.isLocalDraftThread) return false
  await params.api.orchestration.dispatchCommand({
    type: 'thread.create',
    commandId: newCommandId(),
    threadId: params.threadIdForSend,
    projectId: params.project.id,
    title,
    modelSelection: {
      provider: params.selectedProvider,
      model:
        params.selectedModel ||
        params.project.defaultModelSelection?.model ||
        DEFAULT_MODEL_BY_PROVIDER.codex,
      ...(params.selectedModelSelection.options
        ? { options: params.selectedModelSelection.options }
        : {}),
    } as import('@orxa-code/contracts').ModelSelection,
    runtimeMode: params.runtimeMode,
    interactionMode: params.interactionMode,
    branch: nextBranch,
    worktreePath: nextWorktreePath,
    gitRoot: params.thread.gitRoot ?? null,
    createdAt: params.thread.createdAt,
  })
  return true
}

async function persistExistingThreadMeta(params: SendTurnParams, title: string): Promise<void> {
  if (!params.isServerThread) return
  if (params.thread.messages.length === 0)
    await params.api.orchestration.dispatchCommand({
      type: 'thread.meta.update',
      commandId: newCommandId(),
      threadId: params.threadIdForSend,
      title,
    })
  await params.persistThreadSettings({
    threadId: params.threadIdForSend,
    createdAt: params.createdAt,
    ...(params.selectedModel ? { modelSelection: params.selectedModelSelection } : {}),
    runtimeMode: params.runtimeMode,
    interactionMode: params.interactionMode,
  })
}

async function dispatchTurnStart(params: SendTurnParams, title: string): Promise<void> {
  const turnAttachments = await params.turnAttachmentsPromise
  await params.api.orchestration.dispatchCommand({
    type: 'thread.turn.start',
    commandId: newCommandId(),
    threadId: params.threadIdForSend,
    message: {
      messageId: params.messageId,
      role: 'user',
      text: params.outgoingText,
      attachments: turnAttachments,
    },
    modelSelection: params.selectedModelSelection,
    titleSeed: title,
    runtimeMode: params.runtimeMode,
    interactionMode: params.interactionMode,
    createdAt: params.createdAt,
  })
}

export async function executeSendTurn(
  params: SendTurnParams
): Promise<{ turnStartSucceeded: boolean; createdLocalDraft: boolean }> {
  const { nextBranch, nextWorktreePath } = await prepareWorktreeForTurn(params)
  const title = truncate(
    buildTitleSeed(params.trimmed, params.imagesSnapshot, params.terminalContextsSnapshot)
  )
  const createdLocalDraft = await createLocalDraftThreadIfNeeded(
    params,
    nextBranch,
    nextWorktreePath,
    title
  )
  await runSetupScriptIfNeeded(
    params.project,
    params.baseBranchForWorktree,
    nextWorktreePath,
    params.isServerThread,
    createdLocalDraft,
    params.runProjectScript
  )
  await persistExistingThreadMeta(params, title)
  params.beginLocalDispatch({ preparingWorktree: false })
  await dispatchTurnStart(params, title)
  return { turnStartSucceeded: true, createdLocalDraft }
}
