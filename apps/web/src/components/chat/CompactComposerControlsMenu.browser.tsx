import { DEFAULT_MODEL_BY_PROVIDER, ModelSelection, ThreadId } from '@orxa-code/contracts'
import '../../index.css'

import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { CompactComposerControlsMenu } from './CompactComposerControlsMenu'
import { TraitsMenuContent } from './TraitsPicker'
import { useComposerDraftStore } from '../../composerDraftStore'
import {
  CLAUDE_OPUS_MODEL,
  CLAUDE_HAIKU_MODEL,
  CLAUDE_SONNET_MODEL,
  CODEX_GPT54_MODEL,
  assertSonnetEffortOptions,
  makeCleanupHandle,
} from './chat.browser.fixtures'

const COMPACT_MENU_THREAD_ID = ThreadId.makeUnsafe('thread-compact-menu')
const PROVIDER_MODELS = {
  claudeAgent: [CLAUDE_OPUS_MODEL, CLAUDE_HAIKU_MODEL, CLAUDE_SONNET_MODEL],
  codex: [CODEX_GPT54_MODEL],
} as const

function resetComposerDraftState() {
  document.body.innerHTML = ''
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
  })
}

function seedComposerDraft(props?: { modelSelection?: ModelSelection; prompt?: string }) {
  const provider = props?.modelSelection?.provider ?? 'claudeAgent'
  const model = props?.modelSelection?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider]
  const draftsByThreadId = {} as ReturnType<
    typeof useComposerDraftStore.getState
  >['draftsByThreadId']

  draftsByThreadId[COMPACT_MENU_THREAD_ID] = {
    prompt: props?.prompt ?? '',
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    modelSelectionByProvider: {
      [provider]: {
        provider,
        model,
        ...(props?.modelSelection?.options ? { options: props.modelSelection.options } : {}),
      },
    },
    activeProvider: provider,
    runtimeMode: null,
    interactionMode: null,
  }

  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  })

  return {
    model,
    provider,
    providerOptions: props?.modelSelection?.options,
    prompt: props?.prompt ?? '',
  }
}

async function mountMenu(props?: { modelSelection?: ModelSelection; prompt?: string }) {
  const { model, provider, providerOptions, prompt } = seedComposerDraft(props)
  const host = document.createElement('div')
  document.body.append(host)
  const onPromptChange = vi.fn()
  const models = PROVIDER_MODELS[provider]
  const screen = await render(
    <CompactComposerControlsMenu
      activePlan={false}
      interactionMode="default"
      planSidebarOpen={false}
      runtimeMode="approval-required"
      traitsMenuContent={
        <TraitsMenuContent
          provider={provider}
          models={models}
          threadId={COMPACT_MENU_THREAD_ID}
          model={model}
          prompt={prompt}
          modelOptions={providerOptions}
          onPromptChange={onPromptChange}
        />
      }
      onToggleInteractionMode={vi.fn()}
      onTogglePlanSidebar={vi.fn()}
      onToggleRuntimeMode={vi.fn()}
    />,
    { container: host }
  )

  return makeCleanupHandle(screen, host)
}

async function openComposerControlsMenu() {
  await page.getByLabelText('More composer controls').click()
}

async function expectComposerControlsText(assertText: (text: string) => void) {
  await vi.waitFor(() => {
    assertText(document.body.textContent ?? '')
  })
}

async function openMenuForAssertions(
  props: Parameters<typeof mountMenu>[0],
  assertText: (text: string) => void
) {
  await using menuHandle = await mountMenu(props)
  void menuHandle
  await openComposerControlsMenu()
  await expectComposerControlsText(assertText)
}

async function expectFastModeControlsForOpus() {
  await openMenuForAssertions(
    { modelSelection: { provider: 'claudeAgent', model: 'claude-opus-4-6' } },
    text => {
      expect(text).toContain('Fast Mode')
      expect(text).toContain('off')
      expect(text).toContain('on')
    }
  )
}

async function expectNoFastModeControlsForSonnet() {
  await openMenuForAssertions(
    { modelSelection: { provider: 'claudeAgent', model: 'claude-sonnet-4-6' } },
    text => expect(text).not.toContain('Fast Mode')
  )
}

async function expectProvidedEffortOptionsForSonnet() {
  await openMenuForAssertions(
    { modelSelection: { provider: 'claudeAgent', model: 'claude-sonnet-4-6' } },
    assertSonnetEffortOptions
  )
}

async function expectThinkingControlsForHaiku() {
  await openMenuForAssertions(
    {
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-haiku-4-5',
        options: { thinking: true },
      },
    },
    text => {
      expect(text).toContain('Thinking')
      expect(text).toContain('On (default)')
      expect(text).toContain('Off')
    }
  )
}

async function expectPromptControlledUltrathinkState() {
  await openMenuForAssertions(
    {
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
        options: { effort: 'high' },
      },
      prompt: 'Ultrathink:\nInvestigate this',
    },
    text => {
      expect(text).toContain('Effort')
      expect(text).not.toContain('ultrathink')
    }
  )
}

async function expectUltrathinkBodyWarning() {
  await openMenuForAssertions(
    {
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
        options: { effort: 'high' },
      },
      prompt: 'Ultrathink:\nplease ultrathink about this problem',
    },
    text => {
      expect(text).toContain(
        'Your prompt contains "ultrathink" in the text. Remove it to change effort.'
      )
    }
  )
}

describe('CompactComposerControlsMenu', () => {
  afterEach(resetComposerDraftState)

  it('shows fast mode controls for Opus', async () => {
    await expectFastModeControlsForOpus()
  })

  it('hides fast mode controls for non-Opus Claude models', async () => {
    await expectNoFastModeControlsForSonnet()
  })

  it('shows only the provided effort options', async () => {
    await expectProvidedEffortOptionsForSonnet()
  })

  it('shows a Claude thinking on/off section for Haiku', async () => {
    await expectThinkingControlsForHaiku()
  })

  it('shows prompt-controlled Ultrathink state with selectable effort controls', async () => {
    await expectPromptControlledUltrathinkState()
  })

  it('warns when ultrathink appears in prompt body text', async () => {
    await expectUltrathinkBodyWarning()
  })
})
