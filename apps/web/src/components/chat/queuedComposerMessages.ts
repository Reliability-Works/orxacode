import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
} from '@orxa-code/contracts'
import { randomUUID } from '~/lib/utils'
import {
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from '../../lib/terminalContext'
import { cloneComposerImageForRetry, revokeBlobPreviewUrl } from '../ChatView.logic'
import { type ComposerImageAttachment } from '../../composerDraftStore'

export interface QueuedComposerMessage {
  readonly id: string
  readonly createdAt: string
  readonly prompt: string
  readonly trimmed: string
  readonly images: ComposerImageAttachment[]
  readonly terminalContexts: TerminalContextDraft[]
  readonly selectedProvider: ProviderKind
  readonly selectedModel: string
  readonly selectedModelSelection: ModelSelection
  readonly selectedPromptEffort: string | null
  readonly runtimeMode: RuntimeMode
  readonly interactionMode: ProviderInteractionMode
}

export function createQueuedComposerMessage(input: {
  readonly prompt: string
  readonly trimmed: string
  readonly images: ReadonlyArray<ComposerImageAttachment>
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>
  readonly selectedProvider: ProviderKind
  readonly selectedModel: string
  readonly selectedModelSelection: ModelSelection
  readonly selectedPromptEffort: string | null
  readonly runtimeMode: RuntimeMode
  readonly interactionMode: ProviderInteractionMode
}): QueuedComposerMessage {
  return {
    id: `queued:${randomUUID()}`,
    createdAt: new Date().toISOString(),
    prompt: input.prompt,
    trimmed: input.trimmed,
    images: input.images.map(cloneComposerImageForRetry),
    terminalContexts: [...input.terminalContexts],
    selectedProvider: input.selectedProvider,
    selectedModel: input.selectedModel,
    selectedModelSelection: input.selectedModelSelection,
    selectedPromptEffort: input.selectedPromptEffort,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  }
}

export function summarizeQueuedComposerMessage(message: QueuedComposerMessage): {
  readonly providerLabel: string
  readonly modelLabel: string
  readonly previewText: string
  readonly attachmentSummary: string | null
} {
  const providerLabel = PROVIDER_DISPLAY_NAMES[message.selectedProvider] ?? message.selectedProvider
  const modelLabel = message.selectedModel
  const previewText = stripInlineTerminalContextPlaceholders(message.prompt).trim()
  const attachmentParts: string[] = []
  if (message.images.length > 0) {
    attachmentParts.push(
      message.images.length === 1 ? '1 image' : `${message.images.length} images`
    )
  }
  if (message.terminalContexts.length > 0) {
    attachmentParts.push(
      message.terminalContexts.length === 1
        ? '1 terminal context'
        : `${message.terminalContexts.length} terminal contexts`
    )
  }
  return {
    providerLabel,
    modelLabel,
    previewText:
      previewText.length > 0
        ? previewText
        : attachmentParts.length > 0
          ? 'Queued message with attachments'
          : 'Queued message',
    attachmentSummary: attachmentParts.length > 0 ? attachmentParts.join(' • ') : null,
  }
}

export function revokeQueuedComposerMessage(message: QueuedComposerMessage): void {
  for (const image of message.images) {
    revokeBlobPreviewUrl(image.previewUrl)
  }
}
