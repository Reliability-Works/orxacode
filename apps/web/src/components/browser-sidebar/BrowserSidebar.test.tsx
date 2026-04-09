// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesktopBrowserBridge, DesktopBrowserState } from '@orxa-code/contracts'
import { BrowserSidebar } from './BrowserSidebar'
import * as nativeApi from '~/nativeApi'

function createWrapper(queryClient: QueryClient) {
  return function Wrapper(props: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
  }
}

function createBrowserState(overrides?: Partial<DesktopBrowserState>): DesktopBrowserState {
  return {
    tabs: [],
    activeTabId: null,
    activeUrl: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    bounds: null,
    ...overrides,
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function createOpenedState() {
  return createBrowserState({
    tabs: [
      {
        id: 'tab-1',
        title: 'New Tab',
        url: 'about:blank',
        isActive: true,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      },
    ],
    activeTabId: 'tab-1',
    activeUrl: 'about:blank',
  })
}

function createNavigatedState() {
  return createBrowserState({
    tabs: [
      {
        id: 'tab-1',
        title: 'example.com',
        url: 'https://example.com/',
        isActive: true,
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
      },
    ],
    activeTabId: 'tab-1',
    activeUrl: 'https://example.com/',
    canGoBack: true,
  })
}

function createInspectAnnotation() {
  return {
    element: 'Primary CTA',
    selector: 'button.primary',
    text: 'Continue',
    boundingBox: { x: 10, y: 20, width: 120, height: 40 },
    computedStyles: 'display: block;',
  }
}

function createBrowserBridge() {
  const firstState = createBrowserState()
  const openedState = createOpenedState()
  const navigatedState = createNavigatedState()

  const getState = vi.fn<DesktopBrowserBridge['getState']>().mockResolvedValue(firstState)
  const openTab = vi.fn<DesktopBrowserBridge['openTab']>().mockResolvedValue(openedState)
  const navigate = vi
    .fn<DesktopBrowserBridge['navigate']>()
    .mockResolvedValue(navigatedState)

  const enableInspect = vi.fn<DesktopBrowserBridge['enableInspect']>().mockResolvedValue({ ok: true })
  const disableInspect = vi
    .fn<DesktopBrowserBridge['disableInspect']>()
    .mockResolvedValue({ ok: true })
  const pollInspectAnnotation = vi
    .fn<DesktopBrowserBridge['pollInspectAnnotation']>()
    .mockResolvedValueOnce(createInspectAnnotation())
    .mockResolvedValue(null)
  const inspectAtPoint = vi
    .fn<DesktopBrowserBridge['inspectAtPoint']>()
    .mockResolvedValue(createInspectAnnotation())

  const browser: DesktopBrowserBridge = {
    getState,
    navigate,
    back: vi.fn().mockResolvedValue(navigatedState),
    forward: vi.fn().mockResolvedValue(navigatedState),
    reload: vi.fn().mockResolvedValue(navigatedState),
    openTab,
    closeTab: vi.fn().mockResolvedValue(openedState),
    switchTab: vi.fn().mockResolvedValue(openedState),
    setBounds: vi.fn().mockResolvedValue(openedState),
    enableInspect,
    disableInspect,
    pollInspectAnnotation,
    inspectAtPoint,
  }

  return { browser, openTab, navigate, enableInspect, pollInspectAnnotation }
}

afterEach(() => {
  nativeApi.resetNativeApiForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('BrowserSidebar', () => {
  it('shows an unavailable state when the browser bridge is missing', () => {
    vi.spyOn(nativeApi, 'readNativeApi').mockReturnValue(undefined)
    const queryClient = createQueryClient()

    render(<BrowserSidebar onClose={vi.fn()} />, {
      wrapper: createWrapper(queryClient),
    })

    expect(screen.getByText('Browser unavailable')).toBeTruthy()
  })

  it('ensures an initial tab and can navigate with the browser bridge', async () => {
    const { browser, openTab, navigate, enableInspect, pollInspectAnnotation } =
      createBrowserBridge()

    vi.spyOn(nativeApi, 'readNativeApi').mockReturnValue({
      browser,
    } as unknown as ReturnType<typeof nativeApi.readNativeApi>)
    const queryClient = createQueryClient()

    render(<BrowserSidebar onClose={vi.fn()} />, {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(openTab).toHaveBeenCalledTimes(1)
    })

    fireEvent.change(screen.getByLabelText('Browser URL'), {
      target: { value: 'example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('https://example.com')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Enter inspect mode' }))

    await waitFor(() => {
      expect(enableInspect).toHaveBeenCalled()
      expect(pollInspectAnnotation).toHaveBeenCalled()
      expect(screen.getByText('Annotations (1)')).toBeTruthy()
      expect(screen.getByLabelText('Note for Primary CTA')).toBeTruthy()
    })

    vi.useRealTimers()
  })
})
