import type { NativeApi } from '@orxa-code/contracts'

import { createWsNativeApi, resetWsNativeApi, resetWsNativeApiForTests } from './wsNativeApi'

let cachedApi: NativeApi | undefined

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === 'undefined') return undefined
  if (cachedApi) return cachedApi

  if (window.nativeApi) {
    cachedApi = window.nativeApi
    return cachedApi
  }

  cachedApi = createWsNativeApi()
  return cachedApi
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi()
  if (!api) {
    throw new Error('Native API not found')
  }
  return api
}

export async function refreshNativeApi(): Promise<NativeApi | undefined> {
  cachedApi = undefined
  await resetWsNativeApi()
  return readNativeApi()
}

export function resetNativeApiForTests() {
  cachedApi = undefined
  void resetWsNativeApiForTests()
}
