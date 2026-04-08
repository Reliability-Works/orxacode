// Shared mutable test context, worker setup, and per-test lifecycle helpers
// used by ChatView browser tests. This module holds the singleton harness
// instances so that separate scenario files can reference the same live state
// without circular imports. DOM/viewport helpers live in
// ChatView.browser.ctx.dom.ts; row measurement in ChatView.browser.ctx.measure.ts.
import '../index.css'

import {
  ORCHESTRATION_WS_METHODS,
  type EditorId,
  type MessageId,
  type OrchestrationReadModel,
  WS_METHODS,
} from '@orxa-code/contracts'
import React from 'react'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { HttpResponse, http, ws } from 'msw'
import { setupWorker } from 'msw/browser'
import { page } from 'vitest/browser'
import { expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { useComposerDraftStore } from '../composerDraftStore'
import { resetNativeApiForTests } from '../nativeApi'
import { getRouter } from '../router'
import { useStore } from '../store'
import { BrowserWsRpcHarness, type NormalizedWsRpcRequestBody } from '../../test/wsRpcHarness'
import {
  BROWSER_TEST_THREAD_ID as THREAD_ID,
  BROWSER_TEST_PROJECT_ID as PROJECT_ID,
  BROWSER_TEST_NOW_ISO as NOW_ISO,
  type TestFixture,
  buildFixture,
  addThreadToSnapshot,
  createThreadCreatedEvent,
  createSnapshotForTargetUser,
} from './ChatView.browser.helpers'
import {
  type ViewportSpec,
  findButtonByText,
  setViewport,
  waitForElement,
  waitForLayout,
  waitForProductionStyles,
  waitForURL,
} from './ChatView.browser.ctx.dom'
import { type UserRowMeasurement, measureUserRow } from './ChatView.browser.ctx.measure'

export { THREAD_ID, PROJECT_ID, NOW_ISO }

// Re-export DOM helpers so existing scenario modules keep a single import site.
export {
  type ViewportSpec,
  setViewport,
  waitForLayout,
  waitForProductionStyles,
  waitForElement,
  waitForURL,
  waitForComposerEditor,
  waitForComposerMenuItem,
  waitForSendButton,
  findComposerProviderModelPicker,
  findButtonByText,
  waitForButtonByText,
  waitForButtonContainingText,
  expectComposerActionsContained,
  waitForInteractionModeButton,
  dispatchChatNewShortcut,
  triggerChatNewShortcutUntilPath,
  waitForNewThreadShortcutLabel,
} from './ChatView.browser.ctx.dom'
export { type UserRowMeasurement, measureUserRow } from './ChatView.browser.ctx.measure'

const ATTACHMENT_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='300'></svg>"

// ---------------------------------------------------------------------------
// Mutable singleton test context
// ---------------------------------------------------------------------------

export let fixture: TestFixture
export const rpcHarness = new BrowserWsRpcHarness()
export const wsRequests = rpcHarness.requests
export let customWsRpcResolver: ((body: NormalizedWsRpcRequestBody) => unknown | undefined) | null =
  null

export function setFixture(next: TestFixture): void {
  fixture = next
}
export function setCustomResolver(
  fn: ((body: NormalizedWsRpcRequestBody) => unknown | undefined) | null
): void {
  customWsRpcResolver = fn
}

const wsLink = ws.link(/ws(s)?:\/\/.*/)

function resolveWsRpc(body: NormalizedWsRpcRequestBody): unknown {
  const customResult = customWsRpcResolver?.(body)
  if (customResult !== undefined) return customResult
  const tag = body._tag
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) return fixture.snapshot
  if (tag === WS_METHODS.serverGetConfig) return fixture.serverConfig
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: 'main', current: true, isDefault: true, worktreePath: null }],
    }
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: 'main',
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    }
  }
  if (tag === WS_METHODS.projectsSearchEntries) return { entries: [], truncated: false }
  if (tag === WS_METHODS.shellOpenInEditor) return null
  if (tag === WS_METHODS.terminalOpen) {
    return {
      threadId: typeof body.threadId === 'string' ? body.threadId : THREAD_ID,
      terminalId: typeof body.terminalId === 'string' ? body.terminalId : 'default',
      cwd: typeof body.cwd === 'string' ? body.cwd : '/repo/project',
      status: 'running',
      pid: 123,
      history: '',
      exitCode: null,
      exitSignal: null,
      updatedAt: NOW_ISO,
    }
  }
  return {}
}

export const worker = setupWorker(
  wsLink.addEventListener('connection', ({ client }) => {
    void rpcHarness.connect(client)
    client.addEventListener('message', event => {
      const rawData = event.data
      if (typeof rawData !== 'string') return
      void rpcHarness.onMessage(rawData)
    })
  }),
  http.get('*/attachments/:attachmentId', () =>
    HttpResponse.text(ATTACHMENT_SVG, { headers: { 'Content-Type': 'image/svg+xml' } })
  ),
  http.get('*/api/project-favicon', () => new HttpResponse(null, { status: 204 }))
)

export async function waitForServerConfigToApply(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some(r => r._tag === WS_METHODS.subscribeServerConfig)).toBe(true)
    },
    { timeout: 8_000, interval: 16 }
  )
  await waitForLayout()
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

export interface MountedChatView {
  [Symbol.asyncDispose]: () => Promise<void>
  cleanup: () => Promise<void>
  measureUserRow: (targetMessageId: MessageId) => Promise<UserRowMeasurement>
  setViewport: (viewport: ViewportSpec) => Promise<void>
  setContainerSize: (viewport: Pick<ViewportSpec, 'width' | 'height'>) => Promise<void>
  router: ReturnType<typeof getRouter>
}

function createMountHost(): HTMLElement {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.top = '0'
  host.style.left = '0'
  host.style.width = '100vw'
  host.style.height = '100vh'
  host.style.display = 'grid'
  host.style.overflow = 'hidden'
  document.body.append(host)
  return host
}

export async function mountChatView(options: {
  viewport: ViewportSpec
  snapshot: OrchestrationReadModel
  configureFixture?: (fixture: TestFixture) => void
  resolveRpc?: (body: NormalizedWsRpcRequestBody) => unknown | undefined
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot)
  options.configureFixture?.(fixture)
  customWsRpcResolver = options.resolveRpc ?? null
  await setViewport(options.viewport)
  await waitForProductionStyles()
  const host = createMountHost()
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${THREAD_ID}`] }))
  const screen = await render(React.createElement(RouterProvider, { router }), { container: host })
  await waitForLayout()
  const cleanup = async () => {
    customWsRpcResolver = null
    await screen.unmount()
    host.remove()
  }
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    measureUserRow: async (targetMessageId: MessageId) => measureUserRow({ host, targetMessageId }),
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport)
      await waitForProductionStyles()
    },
    setContainerSize: async viewport => {
      host.style.width = `${viewport.width}px`
      host.style.height = `${viewport.height}px`
      await waitForLayout()
    },
    router,
  }
}

export async function measureUserRowAtViewport(options: {
  snapshot: OrchestrationReadModel
  targetMessageId: MessageId
  viewport: ViewportSpec
}): Promise<UserRowMeasurement> {
  const mounted = await mountChatView({ viewport: options.viewport, snapshot: options.snapshot })
  try {
    return await mounted.measureUserRow(options.targetMessageId)
  } finally {
    await mounted.cleanup()
  }
}

// ---------------------------------------------------------------------------
// Domain event helpers
// ---------------------------------------------------------------------------

async function waitForWsClient(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some(r => r._tag === WS_METHODS.subscribeOrchestrationDomainEvents)).toBe(
        true
      )
    },
    { timeout: 8_000, interval: 16 }
  )
}

export async function promoteDraftThreadViaDomainEvent(
  threadId: import('@orxa-code/contracts').ThreadId
): Promise<void> {
  await waitForWsClient()
  fixture.snapshot = addThreadToSnapshot(fixture.snapshot, threadId)
  rpcHarness.emitStreamValue(
    WS_METHODS.subscribeOrchestrationDomainEvents,
    createThreadCreatedEvent(threadId, fixture.snapshot.snapshotSequence)
  )
  await vi.waitFor(
    () => {
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[threadId]).toBeUndefined()
    },
    { timeout: 8_000, interval: 16 }
  )
}

// ---------------------------------------------------------------------------
// Shared lifecycle helpers
// ---------------------------------------------------------------------------

export function sharedBeforeAll(): Promise<unknown> {
  fixture = buildFixture(
    createSnapshotForTargetUser({
      targetMessageId: 'msg-user-bootstrap' as MessageId,
      targetText: 'bootstrap',
    })
  )
  return worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}

export function sharedAfterAll(): Promise<unknown[]> {
  return Promise.all([rpcHarness.disconnect(), worker.stop()])
}

export function sharedBeforeEach(): Promise<void> {
  return rpcHarness.reset({
    resolveUnary: resolveWsRpc,
    getInitialStreamValues: request => {
      if (request._tag === WS_METHODS.subscribeServerLifecycle) {
        return [{ version: 1, sequence: 1, type: 'welcome', payload: fixture.welcome }]
      }
      if (request._tag === WS_METHODS.subscribeServerConfig) {
        return [{ version: 1, type: 'snapshot', config: fixture.serverConfig }]
      }
      return []
    },
  })
}

export function resetTestState(): void {
  resetNativeApiForTests()
  localStorage.clear()
  document.body.innerHTML = ''
  wsRequests.length = 0
  customWsRpcResolver = null
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  })
  useStore.setState({ projects: [], threads: [], bootstrapComplete: false })
}

export async function clickNewThreadAndGetId(options: {
  mounted: MountedChatView
  routeRe: RegExp
}): Promise<import('@orxa-code/contracts').ThreadId> {
  await page.getByTestId('new-thread-button').click()
  const path = await waitForURL(
    options.mounted.router,
    pathname => options.routeRe.test(pathname),
    'Route should have changed to a new draft thread UUID.'
  )
  return path.slice(1) as import('@orxa-code/contracts').ThreadId
}

export async function testSingleEditorOpen(options: {
  editor: EditorId
  snapshotFn: () => import('@orxa-code/contracts').OrchestrationReadModel
  viewportArg?: ViewportSpec
}): Promise<void> {
  const vp = options.viewportArg ?? {
    name: 'desktop',
    width: 960,
    height: 1_100,
    textTolerancePx: 44,
    attachmentTolerancePx: 56,
  }
  const mounted = await mountChatView({
    viewport: vp,
    snapshot: options.snapshotFn(),
    configureFixture: f => {
      f.serverConfig = { ...f.serverConfig, availableEditors: [options.editor] }
    },
  })
  try {
    await waitForServerConfigToApply()
    const openButton = await waitForElement(
      () => findButtonByText('Open'),
      'Unable to find Open button.'
    )
    await vi.waitFor(() => {
      expect(openButton.disabled).toBe(false)
    })
    openButton.click()
    await vi.waitFor(
      () => {
        expect(wsRequests.find(r => r._tag === WS_METHODS.shellOpenInEditor)).toMatchObject({
          _tag: WS_METHODS.shellOpenInEditor,
          cwd: '/repo/project',
          editor: options.editor,
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}
