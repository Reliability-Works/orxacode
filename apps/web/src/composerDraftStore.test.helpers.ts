/**
 * Shared test helper factories for composerDraftStore tests.
 *
 * Extraction-only — no test assertions here, pure data builders only.
 */
import { ThreadId, type ModelSelection, type ProviderModelOptions } from '@orxa-code/contracts'
import { type ComposerImageAttachment, useComposerDraftStore } from './composerDraftStore'
import { type TerminalContextDraft } from './lib/terminalContext'

export function makeImage(input: {
  id: string
  previewUrl: string
  name?: string
  mimeType?: string
  sizeBytes?: number
  lastModified?: number
}): ComposerImageAttachment {
  const name = input.name ?? 'image.png'
  const mimeType = input.mimeType ?? 'image/png'
  const sizeBytes = input.sizeBytes ?? 4
  const lastModified = input.lastModified ?? 1_700_000_000_000
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  })
  return {
    type: 'image',
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  }
}

export function makeTerminalContext(input: {
  id: string
  text?: string
  terminalId?: string
  terminalLabel?: string
  lineStart?: number
  lineEnd?: number
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: ThreadId.makeUnsafe('thread-dedupe'),
    terminalId: input.terminalId ?? 'default',
    terminalLabel: input.terminalLabel ?? 'Terminal 1',
    lineStart: input.lineStart ?? 4,
    lineEnd: input.lineEnd ?? 5,
    text: input.text ?? 'git status\nOn branch main',
    createdAt: '2026-03-13T12:00:00.000Z',
  }
}

export function resetComposerDraftStore(): void {
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  })
}

export function modelSelection(
  provider: 'codex' | 'claudeAgent',
  model: string,
  options?: ModelSelection['options']
): ModelSelection {
  return {
    provider,
    model,
    ...(options ? { options } : {}),
  } as ModelSelection
}

export function providerModelOptions(options: ProviderModelOptions): ProviderModelOptions {
  return options
}
