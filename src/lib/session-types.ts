import type { SessionType } from '../types/canvas'

export function normalizeSessionType(type: string | undefined | null): SessionType | undefined {
  if (!type) {
    return undefined
  }
  if (type === 'standalone') {
    return 'opencode'
  }
  if (
    type === 'opencode' ||
    type === 'canvas' ||
    type === 'codex' ||
    type === 'claude' ||
    type === 'claude-chat'
  ) {
    return type
  }
  return undefined
}

export function isOpencodeSessionType(type: string | undefined | null) {
  const normalized = normalizeSessionType(type)
  return normalized === 'opencode' || normalized === 'canvas'
}

export function isRemoteOpencodeSessionID(sessionID: string | undefined | null) {
  return typeof sessionID === 'string' && sessionID.startsWith('ses')
}

export function isOpencodeRuntimeSession(
  type: string | undefined | null,
  sessionID: string | undefined | null
) {
  return isRemoteOpencodeSessionID(sessionID) && (normalizeSessionType(type) === undefined || isOpencodeSessionType(type))
}
