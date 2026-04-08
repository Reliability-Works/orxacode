import * as Schema from 'effect/Schema'
import { ThreadId } from '@orxa-code/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMPOSER_DRAFT_STORAGE_KEY, useComposerDraftStore } from './composerDraftStore'
import { removeLocalStorageItem, setLocalStorageItem } from './hooks/useLocalStorage'
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
} from './lib/terminalContext'
import {
  makeImage,
  makeTerminalContext,
  resetComposerDraftStore,
} from './composerDraftStore.test.helpers'

describe('composerDraftStore addImages', () => {
  const threadId = ThreadId.makeUnsafe('thread-dedupe')
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>

  beforeEach(() => {
    resetComposerDraftStore()
    originalRevokeObjectUrl = URL.revokeObjectURL
    revokeSpy = vi.fn()
    URL.revokeObjectURL = revokeSpy
  })

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  it('deduplicates identical images in one batch by file signature', () => {
    const first = makeImage({
      id: 'img-1',
      previewUrl: 'blob:first',
      name: 'same.png',
      mimeType: 'image/png',
      sizeBytes: 12,
      lastModified: 12345,
    })
    const duplicate = makeImage({
      id: 'img-2',
      previewUrl: 'blob:duplicate',
      name: 'same.png',
      mimeType: 'image/png',
      sizeBytes: 12,
      lastModified: 12345,
    })
    useComposerDraftStore.getState().addImages(threadId, [first, duplicate])
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.images.map(image => image.id)).toEqual(['img-1'])
    expect(revokeSpy).toHaveBeenCalledWith('blob:duplicate')
  })

  it('deduplicates against existing images across calls by file signature', () => {
    const first = makeImage({
      id: 'img-a',
      previewUrl: 'blob:a',
      name: 'same.png',
      mimeType: 'image/png',
      sizeBytes: 9,
      lastModified: 777,
    })
    const duplicateLater = makeImage({
      id: 'img-b',
      previewUrl: 'blob:b',
      name: 'same.png',
      mimeType: 'image/png',
      sizeBytes: 9,
      lastModified: 999,
    })
    useComposerDraftStore.getState().addImage(threadId, first)
    useComposerDraftStore.getState().addImage(threadId, duplicateLater)
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.images.map(image => image.id)).toEqual(['img-a'])
    expect(revokeSpy).toHaveBeenCalledWith('blob:b')
  })

  it('does not revoke blob URLs that are still used by an accepted duplicate image', () => {
    const first = makeImage({ id: 'img-shared', previewUrl: 'blob:shared' })
    const duplicateSameUrl = makeImage({ id: 'img-shared', previewUrl: 'blob:shared' })
    useComposerDraftStore.getState().addImages(threadId, [first, duplicateSameUrl])
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.images.map(image => image.id)).toEqual(['img-shared'])
    expect(revokeSpy).not.toHaveBeenCalledWith('blob:shared')
  })
})

describe('composerDraftStore clearComposerContent', () => {
  const threadId = ThreadId.makeUnsafe('thread-clear')
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>

  beforeEach(() => {
    resetComposerDraftStore()
    originalRevokeObjectUrl = URL.revokeObjectURL
    revokeSpy = vi.fn()
    URL.revokeObjectURL = revokeSpy
  })

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  it('does not revoke blob preview URLs when clearing composer content', () => {
    const first = makeImage({ id: 'img-optimistic', previewUrl: 'blob:optimistic' })
    useComposerDraftStore.getState().addImage(threadId, first)
    useComposerDraftStore.getState().clearComposerContent(threadId)
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft).toBeUndefined()
    expect(revokeSpy).not.toHaveBeenCalledWith('blob:optimistic')
  })
})

describe('composerDraftStore syncPersistedAttachments', () => {
  const threadId = ThreadId.makeUnsafe('thread-sync-persisted')

  beforeEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY)
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    })
  })

  afterEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY)
  })

  it('treats malformed persisted draft storage as empty', async () => {
    const image = makeImage({ id: 'img-persisted', previewUrl: 'blob:persisted' })
    useComposerDraftStore.getState().addImage(threadId, image)
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      { version: 2, state: { draftsByThreadId: { [threadId]: { attachments: 'not-an-array' } } } },
      Schema.Unknown
    )
    useComposerDraftStore.getState().syncPersistedAttachments(threadId, [
      {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.previewUrl,
      },
    ])
    await Promise.resolve()
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments
    ).toEqual([])
    expect(
      useComposerDraftStore.getState().draftsByThreadId[threadId]?.nonPersistedImageIds
    ).toEqual([image.id])
  })
})

describe('composerDraftStore terminal contexts - deduplication and insertion', () => {
  const threadId = ThreadId.makeUnsafe('thread-dedupe')

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    })
  })

  it('deduplicates identical terminal contexts by selection signature', () => {
    const first = makeTerminalContext({ id: 'ctx-1' })
    const duplicate = makeTerminalContext({ id: 'ctx-2' })
    useComposerDraftStore.getState().addTerminalContexts(threadId, [first, duplicate])
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.terminalContexts.map(context => context.id)).toEqual(['ctx-1'])
  })

  it('clears terminal contexts when clearing composer content', () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadId, makeTerminalContext({ id: 'ctx-1' }))
    useComposerDraftStore.getState().clearComposerContent(threadId)
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined()
  })

  it('inserts terminal contexts at the requested inline prompt position', () => {
    const firstInsertion = insertInlineTerminalContextPlaceholder('alpha beta', 6)
    const secondInsertion = insertInlineTerminalContextPlaceholder(firstInsertion.prompt, 0)
    expect(
      useComposerDraftStore
        .getState()
        .insertTerminalContext(
          threadId,
          firstInsertion.prompt,
          makeTerminalContext({ id: 'ctx-1' }),
          firstInsertion.contextIndex
        )
    ).toBe(true)
    expect(
      useComposerDraftStore.getState().insertTerminalContext(
        threadId,
        secondInsertion.prompt,
        makeTerminalContext({
          id: 'ctx-2',
          terminalLabel: 'Terminal 2',
          lineStart: 9,
          lineEnd: 10,
        }),
        secondInsertion.contextIndex
      )
    ).toBe(true)
    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId]
    expect(draft?.prompt).toBe(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} alpha ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} beta`
    )
    expect(draft?.terminalContexts.map(context => context.id)).toEqual(['ctx-2', 'ctx-1'])
  })
})

describe('composerDraftStore terminal contexts - persistence basics', () => {
  const threadId = ThreadId.makeUnsafe('thread-dedupe')

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    })
  })

  it('omits terminal context text from persisted drafts', () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadId, makeTerminalContext({ id: 'ctx-persist' }))
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        partialize: (state: ReturnType<typeof useComposerDraftStore.getState>) => unknown
      }
    }
    const persistedState = persistApi.getOptions().partialize(useComposerDraftStore.getState()) as {
      draftsByThreadId?: Record<string, { terminalContexts?: Array<Record<string, unknown>> }>
    }
    expect(
      persistedState.draftsByThreadId?.[threadId]?.terminalContexts?.[0],
      'Expected terminal context metadata to be persisted.'
    ).toMatchObject({
      id: 'ctx-persist',
      terminalId: 'default',
      terminalLabel: 'Terminal 1',
      lineStart: 4,
      lineEnd: 5,
    })
    expect(persistedState.draftsByThreadId?.[threadId]?.terminalContexts?.[0]?.text).toBeUndefined()
  })
})

describe('composerDraftStore terminal contexts - persistence merge', () => {
  const threadId = ThreadId.makeUnsafe('thread-dedupe')

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    })
  })

  it('hydrates persisted terminal contexts without in-memory snapshot text', () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>
        ) => ReturnType<typeof useComposerDraftStore.getState>
      }
    }
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
            attachments: [],
            terminalContexts: [
              {
                id: 'ctx-rehydrated',
                threadId,
                createdAt: '2026-03-13T12:00:00.000Z',
                terminalId: 'default',
                terminalLabel: 'Terminal 1',
                lineStart: 4,
                lineEnd: 5,
              },
            ],
          },
        },
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectId: {},
      },
      useComposerDraftStore.getInitialState()
    )
    expect(mergedState.draftsByThreadId[threadId]?.terminalContexts).toMatchObject([
      {
        id: 'ctx-rehydrated',
        terminalId: 'default',
        terminalLabel: 'Terminal 1',
        lineStart: 4,
        lineEnd: 5,
        text: '',
      },
    ])
  })
})

describe('composerDraftStore terminal contexts - persistence sanitize', () => {
  const threadId = ThreadId.makeUnsafe('thread-dedupe')

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    })
  })

  it('sanitizes malformed persisted drafts during merge', () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>
        ) => ReturnType<typeof useComposerDraftStore.getState>
      }
    }
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: '',
            attachments: 'not-an-array',
            terminalContexts: 'not-an-array',
            provider: 'bogus-provider',
            modelOptions: 'not-an-object',
          },
        },
        draftThreadsByThreadId: 'not-an-object',
        projectDraftThreadIdByProjectId: 'not-an-object',
      },
      useComposerDraftStore.getInitialState()
    )
    expect(mergedState.draftsByThreadId[threadId]).toBeUndefined()
    expect(mergedState.draftThreadsByThreadId).toEqual({})
    expect(mergedState.projectDraftThreadIdByProjectId).toEqual({})
  })
})
