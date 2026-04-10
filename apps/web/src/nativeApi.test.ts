import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createWsNativeApiMock = vi.fn()
const resetWsNativeApiMock = vi.fn()

vi.mock('./wsNativeApi', () => ({
  createWsNativeApi: () => createWsNativeApiMock(),
  resetWsNativeApi: () => resetWsNativeApiMock(),
  resetWsNativeApiForTests: () => Promise.resolve(),
}))

function getWindowForTest(): Window & typeof globalThis & { nativeApi?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { nativeApi?: unknown }
  }
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { nativeApi?: unknown }
  }
  return testGlobal.window
}

describe('nativeApi refreshNativeApi', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Reflect.deleteProperty(getWindowForTest(), 'nativeApi')
  })

  afterEach(async () => {
    const nativeApi = await import('./nativeApi')
    nativeApi.resetNativeApiForTests()
  })

  it('rebuilds the cached websocket native API after a refresh', async () => {
    const firstApi = { dialogs: { pickFolder: vi.fn() } }
    const secondApi = { dialogs: { pickFolder: vi.fn() } }
    createWsNativeApiMock.mockReturnValueOnce(firstApi).mockReturnValueOnce(secondApi)

    const nativeApi = await import('./nativeApi')

    expect(nativeApi.readNativeApi()).toBe(firstApi)
    await expect(nativeApi.refreshNativeApi()).resolves.toBe(secondApi)
    expect(resetWsNativeApiMock).toHaveBeenCalledTimes(1)
    expect(nativeApi.readNativeApi()).toBe(secondApi)
  })
})
