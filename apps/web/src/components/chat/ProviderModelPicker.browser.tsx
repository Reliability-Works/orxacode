import { type ProviderKind, type ServerProvider } from '@orxa-code/contracts'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { ProviderModelPicker } from './ProviderModelPicker'
import { getCustomModelOptionsByProvider } from '../../modelSelection'
import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'

function effort(value: string, isDefault = false) {
  return {
    value,
    label: value,
    ...(isDefault ? { isDefault: true } : {}),
  }
}

const CODEX_STANDARD_CAPS = {
  reasoningEffortLevels: [effort('low'), effort('medium', true), effort('high')],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
} as const

const CLAUDE_STANDARD_CAPS = {
  reasoningEffortLevels: [effort('low'), effort('medium', true), effort('high'), effort('max')],
  supportsFastMode: false,
  supportsThinkingToggle: true,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
} as const

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: 'codex',
    enabled: true,
    installed: true,
    version: '0.116.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: 'gpt-5-codex',
        name: 'GPT-5 Codex',
        isCustom: false,
        capabilities: CODEX_STANDARD_CAPS,
      },
      {
        slug: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        isCustom: false,
        capabilities: CODEX_STANDARD_CAPS,
      },
    ],
  },
  {
    provider: 'claudeAgent',
    enabled: true,
    installed: true,
    version: '1.0.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        isCustom: false,
        capabilities: CLAUDE_STANDARD_CAPS,
      },
      {
        slug: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        isCustom: false,
        capabilities: CLAUDE_STANDARD_CAPS,
      },
      {
        slug: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort('low'), effort('medium', true), effort('high')],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
]

function buildCodexProvider(models: ServerProvider['models']): ServerProvider {
  return {
    provider: 'codex',
    enabled: true,
    installed: true,
    version: '0.116.0',
    status: 'ready',
    auth: { status: 'authenticated' },
    checkedAt: new Date().toISOString(),
    models,
  }
}

async function mountPicker(props: {
  provider: ProviderKind
  model: string
  lockedProvider: ProviderKind | null
  providers?: ReadonlyArray<ServerProvider>
  triggerVariant?: 'ghost' | 'outline'
}) {
  const host = document.createElement('div')
  document.body.append(host)
  const onProviderModelChange = vi.fn()
  const providers = props.providers ?? TEST_PROVIDERS
  const modelOptionsByProvider = getCustomModelOptionsByProvider(
    DEFAULT_UNIFIED_SETTINGS,
    providers,
    props.provider,
    props.model
  )
  const screen = await render(
    <ProviderModelPicker
      provider={props.provider}
      model={props.model}
      lockedProvider={props.lockedProvider}
      providers={providers}
      modelOptionsByProvider={modelOptionsByProvider}
      triggerVariant={props.triggerVariant}
      onProviderModelChange={onProviderModelChange}
    />,
    { container: host }
  )

  return {
    onProviderModelChange,
    cleanup: async () => {
      await screen.unmount()
      host.remove()
    },
  }
}

type MountPickerProps = Parameters<typeof mountPicker>[0]
type MountedPicker = Awaited<ReturnType<typeof mountPicker>>

async function withMountedPicker(
  props: MountPickerProps,
  run: (mounted: MountedPicker) => Promise<void>
) {
  const mounted = await mountPicker(props)
  try {
    await run(mounted)
  } finally {
    await mounted.cleanup()
  }
}

function buildSparkVisibilityProviders(includeSpark: boolean): ReadonlyArray<ServerProvider> {
  const baseCodexModel: ServerProvider['models'][number] = {
    slug: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    isCustom: false,
    capabilities: CODEX_STANDARD_CAPS,
  }
  const sparkCodexModel: ServerProvider['models'][number] = {
    slug: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark',
    isCustom: false,
    capabilities: CODEX_STANDARD_CAPS,
  }

  const codexModels: ServerProvider['models'] = includeSpark
    ? [baseCodexModel, sparkCodexModel]
    : [baseCodexModel]

  return [buildCodexProvider(codexModels), TEST_PROVIDERS[1]!]
}

async function expectCodexSubmenuGap() {
  const providerTriggerElement = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).find(element => element.textContent?.includes('Codex'))
  if (!providerTriggerElement) {
    throw new Error('Expected the Codex provider trigger to be mounted.')
  }

  const modelElement = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
  ).find(element => element.textContent?.includes('GPT-5 Codex'))
  if (!modelElement) {
    throw new Error('Expected the submenu model option to be mounted.')
  }

  const submenuPopup = modelElement.closest('[data-slot="menu-sub-content"]')
  if (!(submenuPopup instanceof HTMLElement)) {
    throw new Error('Expected submenu popup to be mounted.')
  }

  const providerTriggerRect = providerTriggerElement.getBoundingClientRect()
  const submenuRect = submenuPopup.getBoundingClientRect()
  expect(submenuRect.left).toBeGreaterThanOrEqual(providerTriggerRect.right)
  expect(submenuRect.left - providerTriggerRect.right).toBeGreaterThanOrEqual(2)
}

async function testProviderSubmenusWhenSwitchingAllowed() {
  await withMountedPicker(
    { provider: 'claudeAgent', model: 'claude-opus-4-6', lockedProvider: null },
    async () => {
      await page.getByRole('button').click()

      await vi.waitFor(() => {
        const text = document.body.textContent ?? ''
        expect(text).toContain('Codex')
        expect(text).toContain('Claude')
        expect(text).not.toContain('Claude Sonnet 4.6')
      })
    }
  )
}

async function testProviderSubmenuGap() {
  await withMountedPicker(
    { provider: 'claudeAgent', model: 'claude-opus-4-6', lockedProvider: null },
    async () => {
      await page.getByRole('button').click()
      await page.getByRole('menuitem', { name: 'Codex' }).hover()

      await vi.waitFor(() => {
        expect(document.body.textContent ?? '').toContain('GPT-5 Codex')
      })

      await expectCodexSubmenuGap()
    }
  )
}

async function testLockedProviderModels() {
  await withMountedPicker(
    { provider: 'claudeAgent', model: 'claude-opus-4-6', lockedProvider: 'claudeAgent' },
    async () => {
      await page.getByRole('button').click()

      await vi.waitFor(() => {
        const text = document.body.textContent ?? ''
        expect(text).toContain('Claude Sonnet 4.6')
        expect(text).toContain('Claude Haiku 4.5')
        expect(text).not.toContain('Codex')
      })
    }
  )
}

async function assertSparkVisibility(providers: ReadonlyArray<ServerProvider>, visible: boolean) {
  await withMountedPicker(
    {
      provider: 'claudeAgent',
      model: 'claude-opus-4-6',
      lockedProvider: null,
      providers,
    },
    async () => {
      await page.getByRole('button').click()
      await page.getByRole('menuitem', { name: 'Codex' }).hover()

      await vi.waitFor(() => {
        const text = document.body.textContent ?? ''
        expect(text).toContain('GPT-5.3 Codex')
        if (visible) {
          expect(text).toContain('GPT-5.3 Codex Spark')
          return
        }
        expect(text).not.toContain('GPT-5.3 Codex Spark')
      })
    }
  )
}

async function testSparkVisibility() {
  await assertSparkVisibility(buildSparkVisibilityProviders(false), false)
  await assertSparkVisibility(buildSparkVisibilityProviders(true), true)
}

async function testCanonicalSlugDispatch() {
  await withMountedPicker(
    { provider: 'claudeAgent', model: 'claude-opus-4-6', lockedProvider: 'claudeAgent' },
    async mounted => {
      await page.getByRole('button').click()
      await page.getByRole('menuitemradio', { name: 'Claude Sonnet 4.6' }).click()

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith('claudeAgent', 'claude-sonnet-4-6')
    }
  )
}

async function testDisabledProvidersAsEntries() {
  const disabledProviders = TEST_PROVIDERS.slice()
  const claudeIndex = disabledProviders.findIndex(provider => provider.provider === 'claudeAgent')
  if (claudeIndex >= 0) {
    const claudeProvider = disabledProviders[claudeIndex]!
    disabledProviders[claudeIndex] = {
      ...claudeProvider,
      enabled: false,
      status: 'disabled',
    }
  }

  await withMountedPicker(
    {
      provider: 'codex',
      model: 'gpt-5-codex',
      lockedProvider: null,
      providers: disabledProviders,
    },
    async () => {
      await page.getByRole('button').click()

      await vi.waitFor(() => {
        const text = document.body.textContent ?? ''
        expect(text).toContain('Claude')
        expect(text).toContain('Disabled')
        expect(text).not.toContain('Claude Sonnet 4.6')
      })
    }
  )
}

async function testOutlineTriggerStyling() {
  await withMountedPicker(
    {
      provider: 'codex',
      model: 'gpt-5-codex',
      lockedProvider: null,
      triggerVariant: 'outline',
    },
    async () => {
      const button = document.querySelector('button')
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Expected picker trigger button to be rendered.')
      }
      expect(button.className).toContain('border-input')
      expect(button.className).toContain('bg-popover')
    }
  )
}

describe('ProviderModelPicker', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it(
    'shows provider submenus when provider switching is allowed',
    testProviderSubmenusWhenSwitchingAllowed
  )
  it('opens provider submenus with a visible gap from the parent menu', testProviderSubmenuGap)
  it('shows models directly when the provider is locked mid-thread', testLockedProviderModels)
  it('only shows codex spark when the server reports it for the account', testSparkVisibility)
  it('dispatches the canonical slug when a model is selected', testCanonicalSlugDispatch)
  it('shows disabled providers as non-selectable entries', testDisabledProvidersAsEntries)
  it('accepts outline trigger styling', testOutlineTriggerStyling)
})
