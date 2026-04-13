function readTrimmedToken(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getPairingTokenFromUrl(url: URL): string | null {
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const hashToken = readTrimmedToken(new URLSearchParams(hash).get('token'))
  if (hashToken) {
    return hashToken
  }

  return readTrimmedToken(url.searchParams.get('token'))
}

export function stripPairingTokenFromUrl(url: URL): URL {
  const next = new URL(url.toString())
  next.searchParams.delete('token')

  const hash = next.hash.startsWith('#') ? next.hash.slice(1) : next.hash
  if (hash.length === 0) {
    next.hash = ''
    return next
  }

  const hashParams = new URLSearchParams(hash)
  hashParams.delete('token')
  const nextHash = hashParams.toString()
  next.hash = nextHash.length > 0 ? `#${nextHash}` : ''
  return next
}
