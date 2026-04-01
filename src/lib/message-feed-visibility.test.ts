import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import {
  extractVisibleText,
  getVisibleParts,
  shouldHideAssistantText,
} from './message-feed-visibility'

describe('message-feed-visibility helpers', () => {
  it('filters user-visible parts and keeps attachments when user text is visible', () => {
    const parts = [
      { id: 'text-visible', type: 'text', text: 'Ship this change today.' },
      {
        id: 'text-internal',
        type: 'text',
        text: '[ORXA_BROWSER_RESULT]{"action":"navigate","ok":true}',
      },
      { id: 'file-1', type: 'file', url: 'https://example.com/log.txt', filename: 'log.txt' },
    ] as unknown as Part[]

    const visibleParts = getVisibleParts('user', parts)

    expect(visibleParts).toHaveLength(2)
    expect(visibleParts.map(part => part.type)).toEqual(['text', 'file'])
  })

  it('drops user file attachments when all user text parts are internal', () => {
    const parts = [
      {
        id: 'text-internal',
        type: 'text',
        text: '[ORXA_BROWSER_RESULT]{"action":"navigate","ok":true}',
      },
      { id: 'file-1', type: 'file', url: 'https://example.com/log.txt', filename: 'log.txt' },
    ] as unknown as Part[]

    const visibleParts = getVisibleParts('user', parts)

    expect(visibleParts).toEqual([])
  })

  it('hides machine/internal assistant text payloads and keeps normal prose', () => {
    expect(
      shouldHideAssistantText(
        '<orxa_browser_action>{"id":"action-1","action":"navigate"}</orxa_browser_action>'
      )
    ).toBe(true)
    expect(shouldHideAssistantText('{"type":"step-start","sessionID":"s1","messageID":"m1"}')).toBe(
      true
    )
    expect(shouldHideAssistantText('Captured first source. Continuing evidence collection.')).toBe(
      false
    )
  })

  it('builds copy text from visible text and file parts', () => {
    const parts = [
      { id: 'text-1', type: 'text', text: 'Line one.' },
      { id: 'file-1', type: 'file', url: 'https://example.com/notes.md', filename: 'notes.md' },
    ] as unknown as Part[]

    expect(extractVisibleText(parts)).toBe('Line one.\n\n[Attached file: notes.md]')
  })
})
