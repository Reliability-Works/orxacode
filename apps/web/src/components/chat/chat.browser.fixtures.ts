/**
 * Shared fixture data for chat component browser tests.
 *
 * Imported by TraitsPicker.browser.tsx, CompactComposerControlsMenu.browser.tsx, etc.
 * Contains model capability data and assertion helpers shared across those suites.
 */
import { expect } from 'vitest'
import type { ServerProvider } from '@orxa-code/contracts'

type ServerProviderModel = ServerProvider['models'][number]

const STD_EFFORT_LEVELS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['ultrathink', 'Ultrathink'],
] as const

function makeClaudeFixtureModel(input: {
  slug: string
  name: string
  fastMode: boolean
  includeMax: boolean
}): ServerProviderModel {
  const reasoningEffortLevels = STD_EFFORT_LEVELS.flatMap(([value, label]) => {
    if (value === 'ultrathink' && input.includeMax) {
      return [
        { value: 'max', label: 'Max' },
        { value, label },
      ]
    }
    return [value === 'high' ? { value, label, isDefault: true } : { value, label }]
  })
  return {
    slug: input.slug,
    name: input.name,
    isCustom: false,
    supportsReasoning: true,
    capabilities: {
      reasoningEffortLevels,
      supportsFastMode: input.fastMode,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ['ultrathink'],
    },
  }
}

export const CLAUDE_OPUS_MODEL: ServerProviderModel = makeClaudeFixtureModel({
  slug: 'claude-opus-4-6',
  name: 'Claude Opus 4.6',
  fastMode: true,
  includeMax: true,
})

export const CLAUDE_SONNET_MODEL: ServerProviderModel = makeClaudeFixtureModel({
  slug: 'claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6',
  fastMode: false,
  includeMax: false,
})

export const CLAUDE_HAIKU_MODEL: ServerProvider['models'][number] = {
  slug: 'claude-haiku-4-5',
  name: 'Claude Haiku 4.5',
  isCustom: false,
  supportsReasoning: false,
  capabilities: {
    reasoningEffortLevels: [],
    supportsFastMode: false,
    supportsThinkingToggle: true,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  },
}

export const CODEX_GPT54_MODEL: ServerProvider['models'][number] = {
  slug: 'gpt-5.4',
  name: 'GPT-5.4',
  isCustom: false,
  supportsReasoning: true,
  capabilities: {
    reasoningEffortLevels: [
      { value: 'xhigh', label: 'Extra High' },
      { value: 'high', label: 'High', isDefault: true },
    ],
    supportsFastMode: true,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  },
}

export const OPENCODE_SONNET_MODEL: ServerProvider['models'][number] = {
  slug: 'anthropic/claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5 (opencode)',
  isCustom: false,
  supportsReasoning: true,
  capabilities: {
    reasoningEffortLevels: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High', isDefault: true },
    ],
    supportsFastMode: false,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  },
}

export const OPENCODE_HAIKU_MODEL: ServerProvider['models'][number] = {
  slug: 'anthropic/claude-haiku-4-5',
  name: 'Claude Haiku 4.5 (opencode)',
  isCustom: false,
  supportsReasoning: false,
  capabilities: {
    reasoningEffortLevels: [],
    supportsFastMode: false,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  },
}

/** Creates a cleanup handle for vitest-browser-react `render` results. */
export function makeCleanupHandle(screen: { unmount: () => Promise<void> }, host: HTMLElement) {
  const cleanup = async () => {
    await screen.unmount()
    host.remove()
  }
  return { [Symbol.asyncDispose]: cleanup, cleanup }
}

/** Asserts that the Sonnet effort options are rendered correctly in the given text. */
export function assertSonnetEffortOptions(text: string): void {
  expect(text).toContain('Low')
  expect(text).toContain('Medium')
  expect(text).toContain('High')
  expect(text).not.toContain('Max')
  expect(text).toContain('Ultrathink')
}
