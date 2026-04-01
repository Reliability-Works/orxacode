import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ClaudeChatEffort, ClaudeChatTurnOptions } from '@shared/ipc'
import type { ModelOption } from '../lib/models'
import type { ClaudeChatMessageItem } from '../hooks/useClaudeChatSession'
import type { Attachment } from '../hooks/useComposerState'
import { useComposerAutocomplete } from '../hooks/useComposerAutocomplete'
import { listProviderCommandAutocompleteEntries } from '../lib/provider-command-catalog'
import { deriveSessionTitleFromPrompt } from '../lib/app-session-utils'
import { applyClaudePromptEffortPrefix, isClaudeUltrathinkPrompt } from '../lib/claude-models'
import { parseComposerSlashCommand } from '../lib/composer-slash-command'
import type { PermissionMode } from '../types/app'

type StartClaudeTurn = (
  prompt: string,
  options?: ClaudeChatTurnOptions & { displayPrompt?: string }
) => Promise<unknown>

type UseClaudeChatPaneComposerArgs = {
  directory: string
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
  setComposer: Dispatch<SetStateAction<string>>
  slashMenuOpen: boolean
  filteredSlashCommands: ReturnType<typeof useComposerAutocomplete>['filteredSlashCommands']
  slashSelectedIndex: number
  insertSlashCommand: ReturnType<typeof useComposerAutocomplete>['insertSlashCommand']
  handleSlashKeyDown: ReturnType<typeof useComposerAutocomplete>['handleSlashKeyDown']
  composerAttachments: Attachment[]
  selectedModel: string | undefined
  setSelectedModel: (value: string | undefined) => void
  effort: ClaudeChatEffort | undefined
  setEffort: (value: ClaudeChatEffort | undefined) => void
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

function useClaudeComposerAttachments(setComposerAttachments: Dispatch<SetStateAction<Attachment[]>>) {
  const addComposerAttachments = useCallback((attachments: Attachment[]) => {
    setComposerAttachments(current => addClaudeComposerAttachments(current, attachments))
  }, [setComposerAttachments])

  const removeAttachment = useCallback((url: string) => {
    setComposerAttachments(current => current.filter(item => item.url !== url))
  }, [setComposerAttachments])

  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage()
      if (selection) {
        addComposerAttachments([selection])
      }
    } catch {
      // Keep Claude composer behavior silent for now; picker failures are non-fatal.
    }
  }, [addComposerAttachments])

  return { addComposerAttachments, removeAttachment, pickImageAttachment }
}

function useClaudePromptSubmission(args: {
  composer: string
  composerAttachments: Attachment[]
  selectedModelId: string | undefined
  permissionMode: PermissionMode
  effort: ClaudeChatEffort | undefined
  fastMode: boolean
  thinking: boolean
  hasUserMessages: boolean
  onFirstMessage?: () => void
  onTitleChange?: (title: string) => void
  setComposer: Dispatch<SetStateAction<string>>
  setComposerAttachments: Dispatch<SetStateAction<Attachment[]>>
  startTurn: StartClaudeTurn
}) {
  const {
    composer,
    composerAttachments,
    selectedModelId,
    permissionMode,
    effort,
    fastMode,
    thinking,
    hasUserMessages,
    onFirstMessage,
    onTitleChange,
    setComposer,
    setComposerAttachments,
    startTurn,
  } = args

  return useCallback(async () => {
    const trimmed = composer.trim()
    const slashCommand = parseComposerSlashCommand(trimmed)
    const planRequested = slashCommand?.command === 'plan'
    const prompt = planRequested ? slashCommand.remainder : trimmed
    if (!prompt && composerAttachments.length === 0) {
      return
    }
    onFirstMessage?.()
    if (!hasUserMessages && prompt) {
      onTitleChange?.(deriveSessionTitleFromPrompt(prompt))
    }
    const attachmentsToSend = [...composerAttachments]
    setComposer('')
    setComposerAttachments([])
    try {
      const promptEffort =
        effort === 'ultrathink' && !isClaudeUltrathinkPrompt(prompt)
          ? applyClaudePromptEffortPrefix(prompt, effort)
          : prompt
      await startTurn(promptEffort, {
        model: selectedModelId,
        permissionMode: planRequested ? 'plan' : permissionMode,
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
  }, [
    composer,
    composerAttachments,
    effort,
    fastMode,
    hasUserMessages,
    onFirstMessage,
    onTitleChange,
    permissionMode,
    selectedModelId,
    setComposer,
    setComposerAttachments,
    startTurn,
    thinking,
  ])
}

export function useClaudeChatPaneComposer({
  directory,
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
  const [thinking, setThinking] = useState(true)
  const [fastMode, setFastMode] = useState(false)
  const handleComposerChange = useCallback<Dispatch<SetStateAction<string>>>(
    value => {
      setComposer(current => (typeof value === 'function' ? value(current) : value))
    },
    []
  )
  const autocomplete = useComposerAutocomplete({
    composer,
    directory,
    provider: 'claude',
    availableSlashCommands: listProviderCommandAutocompleteEntries('claude'),
    setComposer: handleComposerChange,
  })

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      setSelectedModel(modelOptions[0]?.key)
    }
  }, [modelOptions, selectedModel])

  const selectedModelId = useMemo(() => selectedModel?.split('/')[1] ?? undefined, [selectedModel])
  const hasUserMessages = useMemo(
    () => messages.some(item => item.kind === 'message' && item.role === 'user'),
    [messages]
  )
  const { addComposerAttachments, removeAttachment, pickImageAttachment } =
    useClaudeComposerAttachments(setComposerAttachments)
  const sendPrompt = useClaudePromptSubmission({
    composer,
    composerAttachments,
    selectedModelId,
    permissionMode,
    effort,
    fastMode,
    thinking,
    hasUserMessages,
    onFirstMessage,
    onTitleChange,
    setComposer,
    setComposerAttachments,
    startTurn,
  })

  return {
    composer,
    setComposer: handleComposerChange,
    slashMenuOpen: autocomplete.slashMenuOpen,
    filteredSlashCommands: autocomplete.filteredSlashCommands,
    slashSelectedIndex: autocomplete.slashSelectedIndex,
    insertSlashCommand: autocomplete.insertSlashCommand,
    handleSlashKeyDown: autocomplete.handleSlashKeyDown,
    composerAttachments,
    selectedModel,
    setSelectedModel,
    effort,
    setEffort,
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
