import '../../index.css'

import {
  type ModelSelection,
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type ServerProvider,
  ThreadId,
} from '@orxa-code/contracts'
import { page } from 'vitest/browser'
import { useCallback } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TraitsPicker } from './TraitsPicker'
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  ComposerThreadDraftState,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from '../../composerDraftStore'
import { DEFAULT_CLIENT_SETTINGS } from '@orxa-code/contracts/settings'
import {
  CLAUDE_OPUS_MODEL,
  CLAUDE_SONNET_MODEL,
  CLAUDE_HAIKU_MODEL,
  CODEX_GPT54_MODEL,
  OPENCODE_HAIKU_MODEL,
  OPENCODE_SONNET_MODEL,
  assertSonnetEffortOptions,
  makeCleanupHandle,
} from './chat.browser.fixtures'

// ── Claude TraitsPicker tests ─────────────────────────────────────────

const CLAUDE_THREAD_ID = ThreadId.makeUnsafe('thread-claude-traits')
const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: 'codex',
    enabled: true,
    installed: true,
    version: '0.1.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: '2026-01-01T00:00:00.000Z',
    models: [CODEX_GPT54_MODEL],
  },
  {
    provider: 'claudeAgent',
    enabled: true,
    installed: true,
    version: '0.1.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: '2026-01-01T00:00:00.000Z',
    models: [CLAUDE_OPUS_MODEL, CLAUDE_SONNET_MODEL, CLAUDE_HAIKU_MODEL],
  },
]

export function ClaudeTraitsPickerHarness(props: {
  model: string
  fallbackModelSelection: ModelSelection | null
  triggerVariant?: 'ghost' | 'outline'
}) {
  const prompt = useComposerThreadDraft(CLAUDE_THREAD_ID).prompt
  const setPrompt = useComposerDraftStore(store => store.setPrompt)
  const { modelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId: CLAUDE_THREAD_ID,
    providers: TEST_PROVIDERS,
    selectedProvider: 'claudeAgent',
    threadModelSelection: props.fallbackModelSelection,
    projectModelSelection: null,
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  })
  const handlePromptChange = useCallback(
    (nextPrompt: string) => {
      setPrompt(CLAUDE_THREAD_ID, nextPrompt)
    },
    [setPrompt]
  )

  return (
    <TraitsPicker
      provider="claudeAgent"
      models={TEST_PROVIDERS[1]!.models}
      threadId={CLAUDE_THREAD_ID}
      model={selectedModel ?? props.model}
      prompt={prompt}
      modelOptions={modelOptions?.claudeAgent}
      onPromptChange={handlePromptChange}
      triggerVariant={props.triggerVariant}
    />
  )
}

async function mountClaudePicker(props?: {
  model?: string
  prompt?: string
  options?: ClaudeModelOptions
  fallbackModelOptions?: {
    effort?: 'low' | 'medium' | 'high' | 'max' | 'ultrathink'
    thinking?: boolean
    fastMode?: boolean
  } | null
  skipDraftModelOptions?: boolean
  triggerVariant?: 'ghost' | 'outline'
}) {
  const model = props?.model ?? 'claude-opus-4-6'
  const claudeOptions = !props?.skipDraftModelOptions ? props?.options : undefined
  const draftsByThreadId: Record<ThreadId, ComposerThreadDraftState> = {
    [CLAUDE_THREAD_ID]: {
      prompt: props?.prompt ?? '',
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
      modelSelectionByProvider: props?.skipDraftModelOptions
        ? {}
        : {
            claudeAgent: {
              provider: 'claudeAgent',
              model,
              ...(claudeOptions && Object.keys(claudeOptions).length > 0
                ? { options: claudeOptions }
                : {}),
            },
          },
      activeProvider: 'claudeAgent',
      runtimeMode: null,
      interactionMode: null,
    },
  }
  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  })
  const host = document.createElement('div')
  document.body.append(host)
  const fallbackModelSelection =
    props?.fallbackModelOptions !== undefined
      ? ({
          provider: 'claudeAgent',
          model,
          ...(props.fallbackModelOptions ? { options: props.fallbackModelOptions } : {}),
        } satisfies ModelSelection)
      : null
  const screen = await render(
    <ClaudeTraitsPickerHarness
      model={model}
      fallbackModelSelection={fallbackModelSelection}
      {...(props?.triggerVariant ? { triggerVariant: props.triggerVariant } : {})}
    />,
    { container: host }
  )

  return makeCleanupHandle(screen, host)
}

function resetClaudeTraitsPickerState() {
  document.body.innerHTML = ''
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
  })
}

function resetComposerDraftStoreState() {
  localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY)
  resetClaudeTraitsPickerState()
}

async function openTraitsPickerMenu() {
  await page.getByRole('button').click()
}

async function expectTraitsPickerText(assertText: (text: string) => void) {
  await vi.waitFor(() => {
    assertText(document.body.textContent ?? '')
  })
}

async function openClaudePickerForAssertions(
  props: Parameters<typeof mountClaudePicker>[0],
  assertText: (text: string) => void
) {
  await using pickerHandle = await mountClaudePicker(props)
  void pickerHandle
  await openTraitsPickerMenu()
  await expectTraitsPickerText(assertText)
}

async function expectFastModeControlsForOpusPicker() {
  await openClaudePickerForAssertions(undefined, text => {
    expect(text).toContain('Fast Mode')
    expect(text).toContain('off')
    expect(text).toContain('on')
  })
}

async function expectNoFastModeControlsForSonnetPicker() {
  await openClaudePickerForAssertions({ model: 'claude-sonnet-4-6' }, text => {
    expect(text).not.toContain('Fast Mode')
  })
}

async function expectProvidedEffortOptionsForSonnetPicker() {
  await openClaudePickerForAssertions({ model: 'claude-sonnet-4-6' }, assertSonnetEffortOptions)
}

async function expectThinkingControlsForHaikuPicker() {
  await using pickerHandle = await mountClaudePicker({
    model: 'claude-haiku-4-5',
    options: { thinking: true },
  })
  void pickerHandle

  await expectTraitsPickerText(text => {
    expect(text).toContain('Thinking On')
  })
  await openTraitsPickerMenu()
  await expectTraitsPickerText(text => {
    expect(text).toContain('Thinking')
    expect(text).toContain('On (default)')
    expect(text).toContain('Off')
  })
}

async function expectPromptControlledUltrathinkPickerState() {
  await using pickerHandle = await mountClaudePicker({
    model: 'claude-opus-4-6',
    options: { effort: 'high' },
    prompt: 'Ultrathink:\nInvestigate this',
  })
  void pickerHandle

  await expectTraitsPickerText(text => {
    expect(text).toContain('Ultrathink')
    expect(text).not.toContain('Ultrathink · Prompt')
  })
  await openTraitsPickerMenu()
  await expectTraitsPickerText(text => {
    expect(text).toContain('Effort')
    expect(text).not.toContain('ultrathink')
  })
}

async function expectUltrathinkBodyWarningInPicker() {
  await openClaudePickerForAssertions(
    {
      model: 'claude-opus-4-6',
      options: { effort: 'high' },
      prompt: 'Ultrathink:\nplease ultrathink about this problem',
    },
    text => {
      expect(text).toContain(
        'Your prompt contains "ultrathink" in the text. Remove it to change effort.'
      )
    }
  )
}

async function expectStickyClaudeOptionsPersist() {
  await using pickerHandle = await mountClaudePicker({
    model: 'claude-opus-4-6',
    options: { effort: 'medium', fastMode: false },
  })
  void pickerHandle

  await openTraitsPickerMenu()
  await page.getByRole('menuitemradio', { name: 'Max' }).click()

  expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.claudeAgent).toMatchObject(
    {
      provider: 'claudeAgent',
      options: {
        effort: 'max',
      },
    }
  )
}

async function expectOutlineTriggerStyling() {
  await using pickerHandle = await mountClaudePicker({
    triggerVariant: 'outline',
  })
  void pickerHandle

  const button = document.querySelector('button')
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected traits trigger button to be rendered.')
  }
  expect(button.className).toContain('border-input')
  expect(button.className).toContain('bg-popover')
}

describe('TraitsPicker (Claude)', () => {
  afterEach(resetClaudeTraitsPickerState)

  it('shows fast mode controls for Opus', async () => {
    await expectFastModeControlsForOpusPicker()
  })

  it('hides fast mode controls for non-Opus models', async () => {
    await expectNoFastModeControlsForSonnetPicker()
  })

  it('shows only the provided effort options', async () => {
    await expectProvidedEffortOptionsForSonnetPicker()
  })

  it('shows a th  inking on/off dropdown for Haiku', async () => {
    await expectThinkingControlsForHaikuPicker()
  })

  it('shows prompt-controlled Ultrathink state with selectable effort controls', async () => {
    await expectPromptControlledUltrathinkPickerState()
  })

  it('warns when ultrathink appears in prompt body text', async () => {
    await expectUltrathinkBodyWarningInPicker()
  })

  it('persists sticky claude model options when traits change', async () => {
    await expectStickyClaudeOptionsPersist()
  })

  it('accepts outline trigger styling', async () => {
    await expectOutlineTriggerStyling()
  })
})

// ── Codex TraitsPicker tests ──────────────────────────────────────────

async function mountCodexPicker(props: { model?: string; options?: CodexModelOptions }) {
  const threadId = ThreadId.makeUnsafe('thread-codex-traits')
  const model = props.model ?? DEFAULT_MODEL_BY_PROVIDER.codex
  const draftsByThreadId: Record<ThreadId, ComposerThreadDraftState> = {
    [threadId]: {
      prompt: '',
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
      modelSelectionByProvider: {
        codex: {
          provider: 'codex',
          model,
          ...(props.options ? { options: props.options } : {}),
        },
      },
      activeProvider: 'codex',
      runtimeMode: null,
      interactionMode: null,
    },
  }

  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {
      [ProjectId.makeUnsafe('project-codex-traits')]: threadId,
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const screen = await render(
    <TraitsPicker
      provider="codex"
      models={TEST_PROVIDERS[0]!.models}
      threadId={threadId}
      model={props.model ?? DEFAULT_MODEL_BY_PROVIDER.codex}
      prompt=""
      modelOptions={props.options}
      onPromptChange={() => {}}
    />,
    { container: host }
  )

  return makeCleanupHandle(screen, host)
}

async function withCodexPickerOpen(assertText: (text: string) => void): Promise<void> {
  await using pickerHandle = await mountCodexPicker({ options: { fastMode: false } })
  void pickerHandle
  await page.getByRole('button').click()
  await vi.waitFor(() => {
    assertText(document.body.textContent ?? '')
  })
}

describe('TraitsPicker (Codex)', () => {
  afterEach(resetComposerDraftStoreState)

  it('shows fast mode controls', async () => {
    await withCodexPickerOpen(text => {
      expect(text).toContain('Fast Mode')
      expect(text).toContain('off')
      expect(text).toContain('on')
    })
  })

  it('shows Fast in the trigger label when fast mode is active', async () => {
    await using pickerHandle = await mountCodexPicker({
      options: { fastMode: true },
    })
    void pickerHandle

    await vi.waitFor(() => {
      expect(document.body.textContent ?? '').toContain('High · Fast')
    })
  })

  it('shows only the provided effort options', async () => {
    await withCodexPickerOpen(text => {
      expect(text).toContain('Extra High')
      expect(text).toContain('High')
      expect(text).not.toContain('Low')
      expect(text).not.toContain('Medium')
    })
  })

  it('persists sticky codex model options when traits change', async () => {
    await using pickerHandle = await mountCodexPicker({
      options: { fastMode: false },
    })
    void pickerHandle

    await page.getByRole('button').click()
    await page.getByRole('menuitemradio', { name: 'on' }).click()

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.codex).toMatchObject({
      provider: 'codex',
      options: { fastMode: true },
    })
  })
})

// ── Reasoning capability gate tests ───────────────────────────────────

async function mountReasoningGatePicker(input: {
  provider: 'claudeAgent' | 'codex' | 'opencode'
  models: ReadonlyArray<ServerProvider['models'][number]>
  model: string
}) {
  const threadId = ThreadId.makeUnsafe(`thread-gate-${input.provider}-${input.model}`)
  useComposerDraftStore.setState({
    draftsByThreadId: {
      [threadId]: {
        prompt: '',
        images: [],
        nonPersistedImageIds: [],
        persistedAttachments: [],
        terminalContexts: [],
        modelSelectionByProvider: {},
        activeProvider: input.provider,
        runtimeMode: null,
        interactionMode: null,
      },
    },
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  })
  const host = document.createElement('div')
  document.body.append(host)
  const screen = await render(
    <TraitsPicker
      provider={input.provider}
      models={input.models}
      threadId={threadId}
      model={input.model}
      prompt=""
      onPromptChange={() => {}}
    />,
    { container: host }
  )
  return makeCleanupHandle(screen, host)
}

describe('TraitsPicker reasoning capability gate', () => {
  afterEach(resetComposerDraftStoreState)

  it('hides the effort selector for a claude model with supportsReasoning=false', async () => {
    const claudeModel = {
      ...CLAUDE_SONNET_MODEL,
      supportsReasoning: false,
    }
    await using pickerHandle = await mountReasoningGatePicker({
      provider: 'claudeAgent',
      models: [claudeModel],
      model: claudeModel.slug,
    })
    void pickerHandle
    // Trigger label is empty when effort is gated off AND the model has no
    // fast mode, thinking toggle, or context window options.
    const button = document.querySelector('button')
    expect(button?.textContent?.trim() ?? '').toBe('')
  })

  it('shows the effort selector for a codex model (supportsReasoning=true)', async () => {
    await using pickerHandle = await mountReasoningGatePicker({
      provider: 'codex',
      models: [CODEX_GPT54_MODEL],
      model: CODEX_GPT54_MODEL.slug,
    })
    void pickerHandle
    // Default codex effort is 'high'; the trigger label surfaces it.
    await vi.waitFor(() => {
      expect(document.querySelector('button')?.textContent ?? '').toContain('High')
    })
  })

  it('hides the effort selector for an opencode model with supportsReasoning=false', async () => {
    await using pickerHandle = await mountReasoningGatePicker({
      provider: 'opencode',
      models: [OPENCODE_HAIKU_MODEL],
      model: OPENCODE_HAIKU_MODEL.slug,
    })
    void pickerHandle
    const button = document.querySelector('button')
    expect(button?.textContent?.trim() ?? '').toBe('')
  })

  it('shows the effort selector for an opencode model with supportsReasoning=true', async () => {
    await using pickerHandle = await mountReasoningGatePicker({
      provider: 'opencode',
      models: [OPENCODE_SONNET_MODEL],
      model: OPENCODE_SONNET_MODEL.slug,
    })
    void pickerHandle
    await vi.waitFor(() => {
      expect(document.querySelector('button')?.textContent ?? '').toContain('High')
    })
  })
})
