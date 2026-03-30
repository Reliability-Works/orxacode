import { useEffect, useMemo, useState } from 'react'
import type { ClaudeChatEffort, ClaudeChatTurnOptions } from '@shared/ipc'
import type { ModelOption } from '../lib/models'
import type { ClaudeChatMessageItem } from '../hooks/useClaudeChatSession'
import type { Attachment } from '../hooks/useComposerState'
import { deriveSessionTitleFromPrompt } from '../lib/app-session-utils'
import { applyClaudePromptEffortPrefix, isClaudeUltrathinkPrompt } from '../lib/claude-models'
import type { PermissionMode } from '../types/app'

type StartClaudeTurn = (
  prompt: string,
  options?: ClaudeChatTurnOptions & { displayPrompt?: string }
) => Promise<unknown>

type UseClaudeChatPaneComposerArgs = {
  messages: ClaudeChatMessageItem[]
  modelOptions: ModelOption[]
  permissionMode: PermissionMode
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
  startTurn: StartClaudeTurn
  interruptTurn: () => void | Promise<void>
}

export type ClaudeChatPaneComposerViewModel = {
  composer: string
  setComposer: (value: string) => void
  composerAttachments: Attachment[]
  selectedModel: string | undefined
  setSelectedModel: (value: string | undefined) => void
  effort: ClaudeChatEffort | undefined
  setEffort: (value: ClaudeChatEffort | undefined) => void
  isPlanMode: boolean
  setIsPlanMode: (value: boolean) => void
  thinking: boolean
  setThinking: (value: boolean) => void
  fastMode: boolean
  setFastMode: (value: boolean) => void
  selectedModelId: string | undefined
  addComposerAttachments: (attachments: Attachment[]) => void
  removeAttachment: (url: string) => void
  pickImageAttachment: () => Promise<void>
  sendPrompt: () => Promise<void>
  abortActiveSession: () => void
}

function addClaudeComposerAttachments(current: Attachment[], attachments: Attachment[]) {
  if (attachments.length === 0) {
    return current
  }
  const seen = new Set(current.map(item => item.url))
  const next: Attachment[] = []
  for (const attachment of attachments) {
    if (!attachment.url || seen.has(attachment.url)) {
      continue
    }
    seen.add(attachment.url)
    next.push(attachment)
  }
  return next.length > 0 ? [...current, ...next] : current
}

function buildClaudeDisplayPrompt(prompt: string, attachmentCount: number) {
  if (attachmentCount <= 0) {
    return prompt
  }
  const attachmentLabel = attachmentCount === 1 ? '[image]' : `[image x${attachmentCount}]`
  return prompt.trim().length > 0 ? `${attachmentLabel} ${prompt}` : attachmentLabel
}

export function useClaudeChatPaneComposer({
  messages,
  modelOptions,
  permissionMode,
  onFirstMessage,
  onTitleChange,
  startTurn,
  interruptTurn,
}: UseClaudeChatPaneComposerArgs): ClaudeChatPaneComposerViewModel {
  const [composer, setComposer] = useState('')
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([])
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)
  const [effort, setEffort] = useState<ClaudeChatEffort | undefined>(undefined)
  const [isPlanMode, setIsPlanMode] = useState(false)
  const [thinking, setThinking] = useState(true)
  const [fastMode, setFastMode] = useState(false)

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      setSelectedModel(modelOptions[0]?.key)
    }
  }, [modelOptions, selectedModel])

  const selectedModelId = useMemo(() => selectedModel?.split('/')[1] ?? undefined, [selectedModel])
  const promptEffort = useMemo(
    () =>
      effort === 'ultrathink' && !isClaudeUltrathinkPrompt(composer)
        ? applyClaudePromptEffortPrefix(composer, effort)
        : composer,
    [composer, effort]
  )
  const hasUserMessages = useMemo(
    () => messages.some(item => item.kind === 'message' && item.role === 'user'),
    [messages]
  )

  const addComposerAttachments = (attachments: Attachment[]) => {
    setComposerAttachments(current => addClaudeComposerAttachments(current, attachments))
  }

  const removeAttachment = (url: string) => {
    setComposerAttachments(current => current.filter(item => item.url !== url))
  }

  const pickImageAttachment = async () => {
    try {
      const selection = await window.orxa.opencode.pickImage()
      if (!selection) {
        return
      }
      addComposerAttachments([selection])
    } catch {
      // Keep Claude composer behavior silent for now; picker failures are non-fatal.
    }
  }

  const sendPrompt = async () => {
    const trimmed = composer.trim()
    if (!trimmed && composerAttachments.length === 0) {
      return
    }
    onFirstMessage?.()
    if (!hasUserMessages && trimmed) {
      onTitleChange?.(deriveSessionTitleFromPrompt(trimmed))
    }
    const attachmentsToSend = [...composerAttachments]
    setComposer('')
    setComposerAttachments([])
    try {
      await startTurn(promptEffort, {
        model: selectedModelId,
        permissionMode: isPlanMode ? 'plan' : permissionMode,
        effort,
        fastMode,
        thinking,
        attachments: attachmentsToSend,
        displayPrompt: buildClaudeDisplayPrompt(trimmed, attachmentsToSend.length),
      })
    } catch {
      setComposer(trimmed)
      setComposerAttachments(attachmentsToSend)
    }
  }

  return {
    composer,
    setComposer,
    composerAttachments,
    selectedModel,
    setSelectedModel,
    effort,
    setEffort,
    isPlanMode,
    setIsPlanMode,
    thinking,
    setThinking,
    fastMode,
    setFastMode,
    selectedModelId,
    addComposerAttachments,
    removeAttachment,
    pickImageAttachment,
    sendPrompt,
    abortActiveSession: () => void interruptTurn(),
  }
}
