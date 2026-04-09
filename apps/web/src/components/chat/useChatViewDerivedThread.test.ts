import { describe, expect, it } from 'vitest'
import type { ServerProvider } from '@orxa-code/contracts'
import type { Thread } from '../../types'
import { buildModelOptionsByProvider, pickLockedProvider } from './useChatViewDerivedThread'

function makeProvider(provider: ServerProvider['provider'], modelSlugs: string[]): ServerProvider {
  return {
    provider,
    enabled: true,
    installed: true,
    version: null,
    status: 'ready',
    auth: { status: 'authenticated' as const },
    checkedAt: '2026-04-08T00:00:00.000Z',
    models: modelSlugs.map(slug => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
  }
}

describe('buildModelOptionsByProvider', () => {
  it('returns opencode models exclusively when provider is opencode', () => {
    const statuses: ServerProvider[] = [
      makeProvider('opencode', ['anthropic/claude-sonnet-4-5', 'openai/gpt-5']),
      makeProvider('codex', ['gpt-5.4', 'gpt-5.4-mini', 'codex-spark']),
      makeProvider('claudeAgent', ['claude-opus-4-6']),
    ]
    const result = buildModelOptionsByProvider(statuses)
    const opencodeSlugs = result.opencode.map(m => m.slug)
    expect(opencodeSlugs).toEqual(['anthropic/claude-sonnet-4-5', 'openai/gpt-5'])
  })

  it('does not leak codex models into the opencode bucket', () => {
    const statuses: ServerProvider[] = [
      makeProvider('opencode', ['anthropic/claude-sonnet-4-5', 'openai/gpt-5']),
      makeProvider('codex', ['gpt-5.4', 'gpt-5.4-mini', 'codex-spark']),
    ]
    const result = buildModelOptionsByProvider(statuses)
    const opencodeSlugs = result.opencode.map(m => m.slug)
    const codexSlugs = ['gpt-5.4', 'gpt-5.4-mini', 'codex-spark']
    for (const slug of codexSlugs) {
      expect(opencodeSlugs).not.toContain(slug)
    }
  })

  it('returns codex models for the codex bucket without regression', () => {
    const statuses: ServerProvider[] = [
      makeProvider('codex', ['gpt-5.4', 'gpt-5.4-mini', 'codex-spark']),
      makeProvider('opencode', ['anthropic/claude-sonnet-4-5']),
    ]
    const result = buildModelOptionsByProvider(statuses)
    const codexSlugs = result.codex.map(m => m.slug)
    expect(codexSlugs).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'codex-spark'])
  })

  it('returns empty arrays when a provider is not in the statuses', () => {
    const statuses: ServerProvider[] = [makeProvider('codex', ['gpt-5.4'])]
    const result = buildModelOptionsByProvider(statuses)
    expect(result.opencode).toEqual([])
    expect(result.claudeAgent).toEqual([])
  })
})

describe('pickLockedProvider', () => {
  function threadWithModelSelection(provider: 'claudeAgent' | 'codex' | 'opencode'): Thread {
    return {
      modelSelection: { provider, model: 'any' },
    } as unknown as Thread
  }

  it('locks to the thread model selection even when the thread has not started', () => {
    expect(pickLockedProvider(threadWithModelSelection('opencode'), null, null)).toBe('opencode')
    expect(pickLockedProvider(threadWithModelSelection('claudeAgent'), null, null)).toBe(
      'claudeAgent'
    )
    expect(pickLockedProvider(threadWithModelSelection('codex'), null, null)).toBe('codex')
  })

  it('prefers the session provider over the thread model selection', () => {
    const thread = {
      modelSelection: { provider: 'codex', model: 'gpt' },
      session: { provider: 'opencode' },
    } as unknown as Thread
    expect(pickLockedProvider(thread, null, null)).toBe('opencode')
  })

  it('falls back to the active project default when the thread has no provider', () => {
    expect(
      pickLockedProvider(undefined, null, { defaultModelSelection: { provider: 'claudeAgent' } })
    ).toBe('claudeAgent')
  })

  it('returns null when nothing is known', () => {
    expect(pickLockedProvider(undefined, null, null)).toBeNull()
  })
})
