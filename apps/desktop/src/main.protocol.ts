import * as FS from 'node:fs'
import * as Path from 'node:path'

import { protocol } from 'electron'

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl)
    return Path.extname(url.pathname).length > 0
  } catch {
    return false
  }
}

export function registerDesktopFileProtocol(input: {
  readonly isDevelopment: boolean
  readonly alreadyRegistered: boolean
  readonly desktopScheme: string
  resolveDesktopStaticDir(): string | null
  resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string
  markRegistered(): void
}): void {
  if (input.isDevelopment || input.alreadyRegistered) return

  const staticRoot = input.resolveDesktopStaticDir()
  if (!staticRoot) {
    throw new Error('Desktop static bundle missing. Build apps/server (with bundled client) first.')
  }

  const staticRootResolved = Path.resolve(staticRoot)
  const staticRootPrefix = `${staticRootResolved}${Path.sep}`
  const fallbackIndex = Path.join(staticRootResolved, 'index.html')

  protocol.registerFileProtocol(input.desktopScheme, (request, callback) => {
    try {
      const candidate = input.resolveDesktopStaticPath(staticRootResolved, request.url)
      const resolvedCandidate = Path.resolve(candidate)
      const isInRoot =
        resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix)
      if ((!isInRoot || !FS.existsSync(resolvedCandidate)) && isStaticAssetRequest(request.url)) {
        callback({ error: -6 })
        return
      }
      callback({
        path: !isInRoot || !FS.existsSync(resolvedCandidate) ? fallbackIndex : resolvedCandidate,
      })
    } catch {
      callback({ path: fallbackIndex })
    }
  })

  input.markRegistered()
}
