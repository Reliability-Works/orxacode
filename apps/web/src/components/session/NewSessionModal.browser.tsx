import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SERVER_SETTINGS } from '@orxa-code/contracts'
import type { ProviderKind, ServerProvider } from '@orxa-code/contracts'
import { setServerConfigSnapshot } from '~/rpc/serverState'
import { NewSessionModal } from './NewSessionModal'

// ── Hook mock ─────────────────────────────────────────────────────────

const createMock = vi.fn<(input: { provider: ProviderKind; model: string }) => Promise<void>>()

vi.mock('./useNewSessionCreate', () => ({
  useNewSessionCreate: () => ({ create: createMock }),
}))

// ── Helpers ────────────────────────────────────────────────────────────

function makeProvider(
  provider: ServerProvider['provider'],
  status: ServerProvider['status'],
  models: ServerProvider['models'] = []
): ServerProvider {
  return {
    provider,
    enabled: status === 'ready',
    installed: status !== 'disabled',
    version: null,
    status,
    auth: { status: 'authenticated' },
    checkedAt: new Date().toISOString(),
    models,
  }
}

function seedProviders(
  claudeStatus: ServerProvider['status'],
  codexStatus: ServerProvider['status'],
  opencodeStatus: ServerProvider['status'],
  overrides?: {
    claudeModels?: ServerProvider['models']
    codexModels?: ServerProvider['models']
    opencodeModels?: ServerProvider['models']
  }
): void {
  setServerConfigSnapshot({
    cwd: '/tmp',
    keybindingsConfigPath: '/tmp/keybindings.json',
    keybindings: [],
    issues: [],
    availableEditors: [],
    settings: DEFAULT_SERVER_SETTINGS,
    providers: [
      makeProvider('claudeAgent', claudeStatus, overrides?.claudeModels),
      makeProvider('codex', codexStatus, overrides?.codexModels),
      makeProvider('opencode', opencodeStatus, overrides?.opencodeModels),
    ],
  })
}

async function mountModal(open: boolean) {
  const host = document.createElement('div')
  document.body.append(host)
  const onClose = vi.fn()
  const screen = await render(<NewSessionModal open={open} onClose={onClose} />, {
    container: host,
  })
  return {
    onClose,
    screen,
    cleanup: async () => {
      await screen.unmount()
      host.remove()
    },
  }
}

function findProviderCard(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const card = buttons.find(btn => btn.textContent?.includes(label))
  if (!card) throw new Error(`Expected provider card "${label}" to be rendered.`)
  return card
}

const CLAUDE_SONNET_46: ServerProvider['models'][number] = {
  slug: 'claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6',
  isCustom: false,
  capabilities: null,
}

async function mountWithClaudeReady(): Promise<Awaited<ReturnType<typeof mountModal>>> {
  seedProviders('ready', 'ready', 'ready', { claudeModels: [CLAUDE_SONNET_46] })
  const mounted = await mountModal(true)
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain('Claude')
  })
  return mounted
}

// ── Individual test bodies ─────────────────────────────────────────────

async function testDialogRendersWhenOpen() {
  const mounted = await mountModal(true)
  try {
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('New session')
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testThreeCardsRender() {
  seedProviders('ready', 'ready', 'ready')
  const mounted = await mountModal(true)
  try {
    await vi.waitFor(() => {
      const text = document.body.textContent ?? ''
      expect(text).toContain('Claude')
      expect(text).toContain('Codex')
      expect(text).toContain('Opencode')
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testClaudeCardClickCreatesSession() {
  createMock.mockResolvedValueOnce(undefined)
  const mounted = await mountWithClaudeReady()
  try {
    findProviderCard('Claude').click()
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        provider: 'claudeAgent',
        model: 'claude-sonnet-4-6',
      })
    })
    await vi.waitFor(() => {
      expect(mounted.onClose).toHaveBeenCalled()
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testOpencodeCardClickUsesFirstLiveModel() {
  seedProviders('ready', 'ready', 'ready', {
    opencodeModels: [
      {
        slug: 'openai/gpt-4o',
        name: 'GPT-4o',
        isCustom: false,
        capabilities: null,
      },
    ],
  })
  createMock.mockResolvedValueOnce(undefined)
  const mounted = await mountModal(true)
  try {
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Opencode')
    })
    findProviderCard('Opencode').click()
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({ provider: 'opencode', model: 'openai/gpt-4o' })
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testCodexCardClickFallsBackToDefaultModel() {
  seedProviders('ready', 'ready', 'ready', { codexModels: [] })
  createMock.mockResolvedValueOnce(undefined)
  const mounted = await mountModal(true)
  try {
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Codex')
    })
    findProviderCard('Codex').click()
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({ provider: 'codex', model: 'gpt-5.4' })
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testDisabledCardClickIsNoop() {
  seedProviders('disabled', 'ready', 'ready')
  const mounted = await mountModal(true)
  try {
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Claude')
    })
    findProviderCard('Claude').click()
    // Give time for any accidental call to flush
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(createMock).not.toHaveBeenCalled()
    expect(mounted.onClose).not.toHaveBeenCalled()
  } finally {
    await mounted.cleanup()
  }
}

async function testEnterKeyOnReadyCardCreatesSession() {
  createMock.mockResolvedValueOnce(undefined)
  const mounted = await mountWithClaudeReady()
  try {
    const card = findProviderCard('Claude')
    card.focus()
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalled()
    })
  } finally {
    await mounted.cleanup()
  }
}

async function testDialogHiddenWhenClosed() {
  const mounted = await mountModal(false)
  try {
    const popup = document.querySelector('[data-slot="dialog-popup"]')
    expect(popup).toBeNull()
  } finally {
    await mounted.cleanup()
  }
}

async function testCreateErrorSurfacesInline() {
  createMock.mockRejectedValueOnce(new Error('nope'))
  const mounted = await mountWithClaudeReady()
  try {
    findProviderCard('Claude').click()
    await vi.waitFor(() => {
      expect(document.body.textContent ?? '').toContain('nope')
    })
    expect(mounted.onClose).not.toHaveBeenCalled()
  } finally {
    await mounted.cleanup()
  }
}

// ── Suite ──────────────────────────────────────────────────────────────

describe('NewSessionModal', () => {
  afterEach(() => {
    createMock.mockReset()
    document.body.innerHTML = ''
  })

  it('renders the dialog when open is true', testDialogRendersWhenOpen)
  it('renders three provider cards', testThreeCardsRender)
  it('creates a claude session using the first live model', testClaudeCardClickCreatesSession)
  it(
    'creates an opencode session using the first live model',
    testOpencodeCardClickUsesFirstLiveModel
  )
  it(
    'falls back to DEFAULT_MODEL_BY_PROVIDER when the snapshot has no models',
    testCodexCardClickFallsBackToDefaultModel
  )
  it('does nothing when a disabled card is clicked', testDisabledCardClickIsNoop)
  it(
    'creates a session when Enter is pressed on a focused ready card',
    testEnterKeyOnReadyCardCreatesSession
  )
  it('does not render dialog content when open is false', testDialogHiddenWhenClosed)
  it('surfaces create errors inline without closing the dialog', testCreateErrorSurfacesInline)
})
