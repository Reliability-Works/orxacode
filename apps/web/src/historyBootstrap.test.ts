import { MessageId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { buildBootstrapInput } from './historyBootstrap'

const messageId = (value: string) => MessageId.makeUnsafe(value)

function createTranscriptMessage({
  id,
  role,
  text,
  createdAt,
  attachments,
}: {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  attachments?: Array<{
    type: 'image'
    id: string
    name: string
    mimeType: string
    sizeBytes: number
  }>
}) {
  return {
    id: messageId(id),
    role,
    text,
    createdAt,
    streaming: false,
    ...(attachments ? { attachments } : {}),
  }
}

const underBudgetTranscript = [
  createTranscriptMessage({
    id: 'u-1',
    role: 'user',
    text: 'hello',
    createdAt: '2026-02-09T00:00:00.000Z',
  }),
  createTranscriptMessage({
    id: 'a-1',
    role: 'assistant',
    text: 'world',
    createdAt: '2026-02-09T00:00:01.000Z',
  }),
]

const overBudgetTranscript = [
  createTranscriptMessage({
    id: 'u-1',
    role: 'user',
    text: 'first question with details',
    createdAt: '2026-02-09T00:00:00.000Z',
  }),
  createTranscriptMessage({
    id: 'a-1',
    role: 'assistant',
    text: 'first answer with details',
    createdAt: '2026-02-09T00:00:01.000Z',
  }),
  createTranscriptMessage({
    id: 'u-2',
    role: 'user',
    text: 'second question with details',
    createdAt: '2026-02-09T00:00:02.000Z',
  }),
]

const promptOnlyTranscript = [
  createTranscriptMessage({
    id: 'u-1',
    role: 'user',
    text: 'old context',
    createdAt: '2026-02-09T00:00:00.000Z',
  }),
]

const imageAttachmentTranscript = [
  createTranscriptMessage({
    id: 'u-image',
    role: 'user',
    text: '',
    attachments: [
      {
        type: 'image',
        id: 'img-1',
        name: 'screenshot.png',
        mimeType: 'image/png',
        sizeBytes: 2_048,
      },
    ],
    createdAt: '2026-02-09T00:00:00.000Z',
  }),
]

describe('buildBootstrapInput', () => {
  it('includes full transcript when under budget', () => {
    const result = buildBootstrapInput(underBudgetTranscript, "what's next?", 1_500)

    expect(result.includedCount).toBe(2)
    expect(result.omittedCount).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.text).toContain('USER:\nhello')
    expect(result.text).toContain('ASSISTANT:\nworld')
    expect(result.text).toContain('Latest user request (answer this now):')
    expect(result.text).toContain("what's next?")
  })

  it('truncates older transcript messages when over budget', () => {
    const result = buildBootstrapInput(overBudgetTranscript, 'final request', 320)

    expect(result.truncated).toBe(true)
    expect(result.omittedCount).toBeGreaterThan(0)
    expect(result.includedCount).toBeLessThan(3)
    expect(result.text).toContain('omitted to stay within input limits')
    expect(result.text.length).toBeLessThanOrEqual(320)
  })

  it('preserves the latest prompt when prompt-only fallback is required', () => {
    const latestPrompt = 'Please keep this exact latest prompt.'
    const result = buildBootstrapInput(promptOnlyTranscript, latestPrompt, latestPrompt.length + 3)

    expect(result.text).toBe(latestPrompt)
    expect(result.includedCount).toBe(0)
    expect(result.omittedCount).toBe(1)
    expect(result.truncated).toBe(true)
  })

  it('captures user image attachment context in transcript blocks', () => {
    const result = buildBootstrapInput(
      imageAttachmentTranscript,
      'What does this error mean?',
      1_500
    )

    expect(result.text).toContain('Attached image')
    expect(result.text).toContain('screenshot.png')
  })
})
