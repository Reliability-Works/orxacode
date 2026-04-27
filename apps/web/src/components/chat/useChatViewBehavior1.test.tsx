// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAttachmentPreviewCallbacks } from './useChatViewBehavior1'

function useAttachmentPreviewHarness() {
  const [handoffs, setHandoffs] = useState<Record<string, string[]>>({})
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({})
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({})
  const callbacks = useAttachmentPreviewCallbacks({
    attachmentPreviewHandoffByMessageIdRef,
    attachmentPreviewHandoffTimeoutByMessageIdRef,
    setAttachmentPreviewHandoffByMessageId: setHandoffs,
  } as Parameters<typeof useAttachmentPreviewCallbacks>[0])

  return { handoffs, ...callbacks }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useAttachmentPreviewCallbacks', () => {
  it('keeps optimistic image handoffs until they are explicitly cleared', () => {
    vi.useFakeTimers()
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: revokeObjectUrl })

    const { result } = renderHook(() => useAttachmentPreviewHarness())

    act(() => {
      result.current.handoffAttachmentPreviews('message-1', ['blob:preview-1'])
    })
    expect(result.current.handoffs).toEqual({ 'message-1': ['blob:preview-1'] })

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    expect(result.current.handoffs).toEqual({ 'message-1': ['blob:preview-1'] })
    expect(revokeObjectUrl).not.toHaveBeenCalled()
  })
})
