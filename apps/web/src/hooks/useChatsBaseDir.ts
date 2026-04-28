import { useEffect, useState } from 'react'

import { readNativeApi } from '../nativeApi'

let cachedBaseDir: string | null = null
let inflight: Promise<string | null> | null = null

async function loadBaseDir(): Promise<string | null> {
  if (cachedBaseDir !== null) return cachedBaseDir
  if (inflight) return inflight
  const api = readNativeApi()
  if (!api) return null
  inflight = (async () => {
    try {
      const value = await api.chats.getBaseDir()
      cachedBaseDir = value
      return value
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useChatsBaseDir(): string | null {
  const [baseDir, setBaseDir] = useState<string | null>(cachedBaseDir)
  useEffect(() => {
    if (cachedBaseDir !== null) {
      if (baseDir !== cachedBaseDir) {
        setBaseDir(cachedBaseDir)
      }
      return
    }
    let cancelled = false
    void loadBaseDir().then(value => {
      if (!cancelled) setBaseDir(value)
    })
    return () => {
      cancelled = true
    }
  }, [baseDir])
  return baseDir
}

export function readCachedChatsBaseDir(): string | null {
  return cachedBaseDir
}
