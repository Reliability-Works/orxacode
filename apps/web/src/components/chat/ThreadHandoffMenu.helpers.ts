import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderKind,
} from '@orxa-code/contracts'
import { newCommandId, newMessageId, newThreadId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'

import type { Project, Thread } from '../../types'

const HANDOFF_CONTEXT_MESSAGE_LIMIT = 8
const HANDOFF_MESSAGE_CHAR_LIMIT = 320
const HANDOFF_PROVIDER_ALIASES: Readonly<Record<string, ProviderKind>> = {
  codex: 'codex',
  claude: 'claudeAgent',
  'claude-agent': 'claudeAgent',
  claudeagent: 'claudeAgent',
  opencode: 'opencode',
}

const ALL_HANDOFF_PROVIDERS: ReadonlyArray<ProviderKind> = ['codex', 'claudeAgent', 'opencode']

function truncateText(value: string, limit = HANDOFF_MESSAGE_CHAR_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`
}

export function getHandoffTargetProviders(currentProvider: ProviderKind): ReadonlyArray<ProviderKind> {
  return ALL_HANDOFF_PROVIDERS.filter(provider => provider !== currentProvider)
}

function buildImportedContextSections(thread: Thread): {
  details: string
  transcript: string
} {
  const recentMessages = thread.messages.slice(-HANDOFF_CONTEXT_MESSAGE_LIMIT)
  const transcript = recentMessages
    .map(message => {
      const label =
        message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User'
      return `${label}: ${truncateText(message.text)}`
    })
    .join('\n')
  const details = [
    `Source thread: ${thread.title}`,
    `Source provider: ${thread.modelSelection.provider}`,
    `Source model: ${thread.modelSelection.model}`,
    thread.branch ? `Branch: ${thread.branch}` : null,
    thread.worktreePath ? `Worktree: ${thread.worktreePath}` : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('\n')

  return { details, transcript }
}

export function buildHandoffContext(thread: Thread): string {
  const { details, transcript } = buildImportedContextSections(thread)

  return [
    'Continue this conversation in the target provider.',
    'Treat the following as imported context from another provider thread.',
    '',
    details,
    '',
    'Recent transcript:',
    transcript.length > 0 ? transcript : 'No messages yet.',
    '',
    'Next step:',
    'Pick up from the imported context and continue the task without asking to restate the history unless genuinely required.',
  ].join('\n')
}

export function buildWorktreeHandoffContext(thread: Thread): string {
  const { details, transcript } = buildImportedContextSections(thread)

  return [
    'Continue this conversation in the pull request thread.',
    'Treat the following as imported context from another thread while you work in the prepared branch or worktree.',
    '',
    details,
    '',
    'Recent transcript:',
    transcript.length > 0 ? transcript : 'No messages yet.',
    '',
    'Next step:',
    'Use the imported context to continue the task in this pull request workspace without asking to restate the prior thread unless genuinely required.',
  ].join('\n')
}

export function resolveHandoffTargetProviderArgument(
  currentProvider: ProviderKind,
  rawValue: string
): ProviderKind | null {
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  const provider = HANDOFF_PROVIDER_ALIASES[normalized] ?? null
  if (!provider || provider === currentProvider) {
    return null
  }
  return provider
}

export function resolveTargetModelSelection(
  targetProvider: ProviderKind,
  project: Project | null
): ModelSelection {
  if (project?.defaultModelSelection?.provider === targetProvider) {
    return project.defaultModelSelection
  }
  return {
    provider: targetProvider,
    model: DEFAULT_MODEL_BY_PROVIDER[targetProvider],
  }
}

export async function startThreadHandoff(input: {
  readonly navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
  readonly thread: Thread
  readonly project: Project | null
  readonly targetProvider: ProviderKind
}) {
  const api = readNativeApi()
  if (!api) {
    return
  }
  const threadId = newThreadId()
  const createdAt = new Date().toISOString()
  const modelSelection = resolveTargetModelSelection(input.targetProvider, input.project)
  const bootstrapText = buildHandoffContext(input.thread)

  await api.orchestration.dispatchCommand({
    type: 'thread.create',
    commandId: newCommandId(),
    threadId,
    projectId: input.thread.projectId,
    title: input.thread.title,
    modelSelection,
    runtimeMode: input.thread.runtimeMode,
    interactionMode: 'default',
    branch: input.thread.branch,
    worktreePath: input.thread.worktreePath,
    handoff: {
      sourceThreadId: input.thread.id,
      sourceProvider: input.thread.modelSelection.provider,
      targetProvider: input.targetProvider,
      sourceThreadTitle: input.thread.title,
      createdAt,
    },
    createdAt,
  })
  await api.orchestration.dispatchCommand({
    type: 'thread.turn.start',
    commandId: newCommandId(),
    threadId,
    message: {
      messageId: newMessageId(),
      role: 'user',
      text: bootstrapText,
      attachments: [],
    },
    modelSelection,
    titleSeed: input.thread.title,
    runtimeMode: input.thread.runtimeMode,
    interactionMode: 'default',
    createdAt,
  })
  await input.navigate({ to: '/$threadId', params: { threadId } })
}
