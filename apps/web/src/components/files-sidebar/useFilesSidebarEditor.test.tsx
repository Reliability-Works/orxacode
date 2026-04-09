// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFilesSidebarEditor } from './useFilesSidebarEditor'
import * as wsRpcClient from '../../wsRpcClient'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper(props: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFilesSidebarEditor', () => {
  it('keeps the editor in a loading state while a newly selected file is still being read', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const secondFile = createDeferred<{ relativePath: string; contents: string }>()
    const readFile = vi
      .fn()
      .mockResolvedValueOnce({
        relativePath: 'first.ts',
        contents: 'export const first = 1\n',
      })
      .mockImplementationOnce(() => secondFile.promise)

    vi.spyOn(wsRpcClient, 'getWsRpcClient').mockReturnValue({
      projects: {
        readFile,
        writeFile: vi.fn(),
      },
    } as unknown as ReturnType<typeof wsRpcClient.getWsRpcClient>)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    const { result } = renderHook(() => useFilesSidebarEditor({ cwd: '/repo', onClose: vi.fn() }), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.handleOpenFile('first.ts')
    })

    await waitFor(() => {
      expect(result.current.contents).toBe('export const first = 1\n')
    })
    expect(result.current.isLoading).toBe(false)

    act(() => {
      result.current.handleOpenFile('second.ts')
    })

    expect(result.current.selectedFilePath).toBe('second.ts')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.contents).toBe('')

    await act(async () => {
      secondFile.resolve({
        relativePath: 'second.ts',
        contents: 'export const second = 2\n',
      })
      await secondFile.promise
    })

    await waitFor(() => {
      expect(result.current.contents).toBe('export const second = 2\n')
    })
    expect(result.current.isLoading).toBe(false)
  })
})
