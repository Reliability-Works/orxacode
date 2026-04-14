/**
 * Permission-lifecycle mappers for the opencode adapter.
 *
 * Split out of `OpencodeAdapter.pure.ts` to keep that module under the 500-
 * line lint cap. Pure functions of `(event, context)` — same shape as the
 * mappers that stayed in the parent module.
 *
 * @module OpencodeAdapter.pure.permissions
 */
import {
  type CanonicalRequestType,
  type ProviderRuntimeEvent,
  RuntimeRequestId,
} from '@orxa-code/contracts'

import type { OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import type { OpencodeEvent } from './OpencodeAdapter.types.ts'
import {
  makeBaseForTurn,
  opencodeRawEvent,
  resolveMapperContext,
} from './OpencodeAdapter.shared.ts'

function classifyOpencodePermission(permission: string): CanonicalRequestType {
  switch (permission) {
    case 'bash':
      return 'command_execution_approval'
    case 'edit':
    case 'write':
    case 'apply_patch':
      return 'file_change_approval'
    case 'read':
      return 'file_read_approval'
    default:
      return 'unknown'
  }
}

function summarizePermissionRequest(
  info: Extract<OpencodeEvent, { type: 'permission.asked' }>['properties']
): string | undefined {
  const firstPattern = info.patterns.find(p => p.trim().length > 0)?.trim()
  if (firstPattern) return firstPattern
  const metaTitle =
    typeof info.metadata['title'] === 'string'
      ? (info.metadata['title'] as string).trim()
      : undefined
  if (metaTitle && metaTitle.length > 0) return metaTitle
  return info.permission
}

export function mapPermissionAsked(
  event: Extract<OpencodeEvent, { type: 'permission.asked' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  const requestType = classifyOpencodePermission(info.permission)
  const detail = summarizePermissionRequest(info)
  return [
    {
      ...makeBaseForTurn(ctx, turnId, info.tool?.callID),
      requestId: RuntimeRequestId.makeUnsafe(info.id),
      type: 'request.opened',
      payload: {
        requestType,
        ...(detail ? { detail } : {}),
        args: {
          permission: info.permission,
          patterns: info.patterns,
          metadata: info.metadata,
          ...(info.tool ? { tool: info.tool } : {}),
        },
      },
      raw: opencodeRawEvent(event),
    },
  ]
}

function mapPermissionReply(
  reply: 'once' | 'always' | 'reject'
): 'accept' | 'acceptForSession' | 'decline' {
  switch (reply) {
    case 'once':
      return 'accept'
    case 'always':
      return 'acceptForSession'
    case 'reject':
      return 'decline'
  }
}

export function mapPermissionReplied(
  event: Extract<OpencodeEvent, { type: 'permission.replied' }>,
  ctx: OpencodeMapperContext
): ReadonlyArray<ProviderRuntimeEvent> {
  const info = event.properties
  const resolved = resolveMapperContext(ctx, info.sessionID)
  if (!resolved) return []
  const { turnId } = resolved
  return [
    {
      ...makeBaseForTurn(ctx, turnId),
      requestId: RuntimeRequestId.makeUnsafe(info.requestID),
      // requestType isn't on the replied payload; we re-emit 'unknown' because
      // the resolver downstream already has the requestType from the opened
      // event and only relies on decision + requestId for correlation.
      type: 'request.resolved',
      payload: { requestType: 'unknown', decision: mapPermissionReply(info.reply) },
      raw: opencodeRawEvent(event),
    },
  ]
}
