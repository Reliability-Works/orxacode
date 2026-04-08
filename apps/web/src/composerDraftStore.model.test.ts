import { ThreadId } from '@orxa-code/contracts'
import { beforeEach, describe, expect, it } from 'vitest'

import { useComposerDraftStore } from './composerDraftStore'
import {
  modelSelection,
  providerModelOptions,
  resetComposerDraftStore,
} from './composerDraftStore.test.helpers'

describe('composerDraftStore modelSelection - basic selection', () => {
  const threadId = ThreadId.makeUnsafe('thread-model-options')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('stores a model selection in the draft', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(
      threadId,
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'xhigh', fastMode: true })
    )
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex
    ).toEqual(
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'xhigh', fastMode: true })
    )
  })

  it('keeps default-only model selections on the draft', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(threadId, modelSelection('codex', 'gpt-5.4'))
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex
    ).toEqual(modelSelection('codex', 'gpt-5.4'))
  })

  it('does not clear other provider options when setting options for a single provider', () => {
    const store = useComposerDraftStore.getState()
    store.setModelOptions(
      threadId,
      providerModelOptions({ codex: { fastMode: true }, claudeAgent: { effort: 'max' } })
    )
    store.setModelOptions(threadId, providerModelOptions({ codex: { reasoningEffort: 'xhigh' } }))
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ reasoningEffort: 'xhigh' })
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: 'max' })
  })

  it('preserves other provider options when switching the active model selection', () => {
    const store = useComposerDraftStore.getState()
    store.setModelOptions(
      threadId,
      providerModelOptions({ codex: { fastMode: true }, claudeAgent: { effort: 'max' } })
    )
    store.setModelSelection(threadId, modelSelection('claudeAgent', 'claude-opus-4-6'))
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.modelSelectionByProvider.claudeAgent).toEqual(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    expect(draft?.modelSelectionByProvider.codex?.options).toEqual({ fastMode: true })
    expect(draft?.activeProvider).toBe('claudeAgent')
  })
})

describe('composerDraftStore modelSelection - provider options', () => {
  const threadId = ThreadId.makeUnsafe('thread-model-options')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('replaces only the targeted provider options on the current model selection', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(
      threadId,
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max', fastMode: true })
    )
    store.setStickyModelSelection(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max', fastMode: true })
    )
    store.setProviderModelOptions(
      threadId,
      'claudeAgent',
      { thinking: false },
      { persistSticky: true }
    )
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent
    ).toEqual(modelSelection('claudeAgent', 'claude-opus-4-6', { thinking: false }))
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection('claudeAgent', 'claude-opus-4-6', { thinking: false })
    )
  })

  it('keeps explicit default-state overrides on the selection', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(
      threadId,
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    store.setProviderModelOptions(threadId, 'claudeAgent', { thinking: true })
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent
    ).toEqual(modelSelection('claudeAgent', 'claude-opus-4-6', { thinking: true }))
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toEqual({})
  })

  it('keeps explicit off/default codex overrides on the selection', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(threadId, modelSelection('codex', 'gpt-5.4', { fastMode: true }))
    store.setProviderModelOptions(threadId, 'codex', { reasoningEffort: 'high', fastMode: false })
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex
    ).toEqual(modelSelection('codex', 'gpt-5.4', { reasoningEffort: 'high', fastMode: false }))
  })

  it('updates only the draft when sticky persistence is omitted', () => {
    const store = useComposerDraftStore.getState()
    store.setStickyModelSelection(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    store.setModelSelection(
      threadId,
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    store.setProviderModelOptions(threadId, 'claudeAgent', { thinking: false })
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent
    ).toEqual(modelSelection('claudeAgent', 'claude-opus-4-6', { thinking: false }))
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
  })
})

describe('composerDraftStore modelSelection - sticky persistence', () => {
  const threadId = ThreadId.makeUnsafe('thread-model-options')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('creates the first sticky snapshot from provider option changes', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(threadId, modelSelection('codex', 'gpt-5.4'))
    store.setProviderModelOptions(threadId, 'codex', { fastMode: true }, { persistSticky: true })
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection('codex', 'gpt-5.4', { fastMode: true })
    )
  })

  it('updates only the draft when sticky persistence is disabled', () => {
    const store = useComposerDraftStore.getState()
    store.setStickyModelSelection(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    store.setModelSelection(
      threadId,
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
    store.setProviderModelOptions(
      threadId,
      'claudeAgent',
      { thinking: false },
      { persistSticky: false }
    )
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider
        .claudeAgent
    ).toEqual(modelSelection('claudeAgent', 'claude-opus-4-6', { thinking: false }))
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toEqual(
      modelSelection('claudeAgent', 'claude-opus-4-6', { effort: 'max' })
    )
  })
})

describe('composerDraftStore setModelSelection', () => {
  const threadId = ThreadId.makeUnsafe('thread-model')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('keeps explicit model overrides instead of coercing to null', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(threadId, modelSelection('codex', 'gpt-5.3-codex'))
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.modelSelectionByProvider.codex
    ).toEqual(modelSelection('codex', 'gpt-5.3-codex'))
  })
})

describe('composerDraftStore sticky composer settings', () => {
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('stores a sticky model selection', () => {
    const store = useComposerDraftStore.getState()
    store.setStickyModelSelection(
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'medium', fastMode: true })
    )
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'medium', fastMode: true })
    )
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe('codex')
  })

  it('normalizes empty sticky model options by dropping selection options', () => {
    const store = useComposerDraftStore.getState()
    store.setStickyModelSelection(modelSelection('codex', 'gpt-5.4'))
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toEqual(
      modelSelection('codex', 'gpt-5.4')
    )
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe('codex')
  })

  it('applies sticky activeProvider to new drafts', () => {
    const store = useComposerDraftStore.getState()
    const tid = ThreadId.makeUnsafe('thread-sticky-active-provider')
    store.setStickyModelSelection(modelSelection('claudeAgent', 'claude-opus-4-6'))
    store.applyStickyState(tid)
    expect(useComposerDraftStore.getState().draftsByThreadId[tid]).toMatchObject({
      modelSelectionByProvider: { claudeAgent: modelSelection('claudeAgent', 'claude-opus-4-6') },
      activeProvider: 'claudeAgent',
    })
  })
})

describe('composerDraftStore provider-scoped option updates', () => {
  const threadId = ThreadId.makeUnsafe('thread-provider')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('retains off-provider option memory without changing the active selection', () => {
    const store = useComposerDraftStore.getState()
    store.setModelSelection(
      threadId,
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'medium' })
    )
    store.setProviderModelOptions(threadId, 'claudeAgent', { effort: 'max' })
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.modelSelectionByProvider.codex).toEqual(
      modelSelection('codex', 'gpt-5.3-codex', { reasoningEffort: 'medium' })
    )
    expect(draft?.modelSelectionByProvider.claudeAgent?.options).toEqual({ effort: 'max' })
    expect(draft?.activeProvider).toBe('codex')
  })
})

describe('composerDraftStore runtime and interaction settings', () => {
  const threadId = ThreadId.makeUnsafe('thread-settings')
  beforeEach(() => {
    resetComposerDraftStore()
  })

  it('stores runtime mode overrides in the composer draft', () => {
    useComposerDraftStore.getState().setRuntimeMode(threadId, 'approval-required')
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.runtimeMode).toBe(
      'approval-required'
    )
  })

  it('stores interaction mode overrides in the composer draft', () => {
    useComposerDraftStore.getState().setInteractionMode(threadId, 'plan')
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.interactionMode).toBe(
      'plan'
    )
  })

  it('removes empty settings-only drafts when overrides are cleared', () => {
    const store = useComposerDraftStore.getState()
    store.setRuntimeMode(threadId, 'approval-required')
    store.setInteractionMode(threadId, 'plan')
    store.setRuntimeMode(threadId, null)
    store.setInteractionMode(threadId, null)
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined()
  })
})
