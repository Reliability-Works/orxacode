import type { NativeApi } from '@orxa-code/contracts'

import { resetWsNativeApiForTests } from './wsNativeApi'

let cachedApi: NativeApi | undefined
let activeNativeApi: NativeApi | undefined

export function setActiveNativeApi(api: NativeApi | undefined) {
  activeNativeApi = api
  cachedApi = api
}

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === 'undefined') return undefined
  if (activeNativeApi) return activeNativeApi
  if (cachedApi) return cachedApi

  if (window.nativeApi) {
    cachedApi = window.nativeApi
    return cachedApi
  }
  return undefined
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi()
  if (!api) {
    throw new Error('Native API not found')
  }
  return api
}

export function resetNativeApiForTests() {
  cachedApi = undefined
  activeNativeApi = undefined
  void resetWsNativeApiForTests()
}
