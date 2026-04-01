/** @vitest-environment node */

import { beforeEach, expect, it, vi } from 'vitest'
import { query, type Options as ClaudeQueryOptions } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeChatService } from './claude-chat-service'
import { ProviderSessionDirectory } from './provider-session-directory'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  renameSession: vi.fn(),
  tagSession: vi.fn(),
}))

function captureApprovals(service: ClaudeChatService) {
  const approvals: Array<{ id: string; toolName: string; threadId: string }> = []
  service.on('approval', payload => {
    approvals.push(payload)
  })
  return approvals
}

function captureNotifications(service: ClaudeChatService) {
  const notifications: Array<{ method: string; params: Record<string, unknown> }> = []
  service.on('notification', payload => {
    notifications.push(payload)
  })
  return notifications
}

function createToolApprovalQueryMock(
  toolResults: Array<{ behavior: string; toolUseID: string }>
) {
  const callbackOptions = {
    signal: new AbortController().signal,
  }
  return (input: { options?: ClaudeQueryOptions }) =>
    ({
      interrupt: vi.fn(async () => undefined),
      async *[Symbol.asyncIterator]() {
        const canUseTool = input.options?.canUseTool
        if (!canUseTool) {
          return
        }
        toolResults.push(
          (await canUseTool('WebFetch', { url: 'https://example.com' }, { ...callbackOptions, toolUseID: 'tool-1' })) as {
            behavior: string
            toolUseID: string
          }
        )
        toolResults.push(
          (await canUseTool(
            'WebFetch',
            { url: 'https://example.com/docs' },
            { ...callbackOptions, toolUseID: 'tool-2' }
          )) as {
            behavior: string
            toolUseID: string
          }
        )
        yield* []
      },
    }) as never
}

beforeEach(() => {
  vi.mocked(query).mockReset()
})

it('auto-allows Claude tool callbacks in yolo mode without surfacing approvals', async () => {
  const service = new ClaudeChatService(new ProviderSessionDirectory())
  const approvals = captureApprovals(service)
  const toolResults: Array<{ behavior: string; toolUseID: string }> = []

  vi.mocked(query).mockImplementation(createToolApprovalQueryMock(toolResults))

  await service.startTurn('session-yolo', '/tmp/project', 'apply the fix', {
    model: 'claude-sonnet-4-6',
    permissionMode: 'yolo-write',
  })

  expect(vi.mocked(query)).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    })
  )
  const queryOptions = vi.mocked(query).mock.calls[0]?.[0]?.options
  expect(queryOptions?.canUseTool).toBeTypeOf('function')
  expect(approvals).toEqual([])
  expect(toolResults).toEqual([
    { behavior: 'allow', toolUseID: 'tool-1' },
    { behavior: 'allow', toolUseID: 'tool-2' },
  ])
})

it('persists Claude allow-always approvals per provider thread', async () => {
  const service = new ClaudeChatService(new ProviderSessionDirectory())
  const approvals = captureApprovals(service)
  const toolResults: Array<{ behavior: string; toolUseID: string }> = []

  vi.mocked(query).mockImplementation(createToolApprovalQueryMock(toolResults))

  const turnPromise = service.startTurn('session-allow', '/tmp/project', 'fetch docs', {
    model: 'claude-sonnet-4-6',
    permissionMode: 'ask-write',
  })

  expect(approvals).toHaveLength(1)
  await service.approve(approvals[0]!.id, 'acceptForSession')
  await turnPromise

  expect(approvals).toHaveLength(1)
  expect(toolResults).toEqual([
    { behavior: 'allow', toolUseID: 'tool-1' },
    { behavior: 'allow', toolUseID: 'tool-2' },
  ])
})

it('keeps Claude allow-once scoped to a single callback', async () => {
  const service = new ClaudeChatService(new ProviderSessionDirectory())
  const approvals = captureApprovals(service)
  const toolResults: Array<{ behavior: string; toolUseID: string }> = []

  vi.mocked(query).mockImplementation(createToolApprovalQueryMock(toolResults))

  const turnPromise = service.startTurn('session-once', '/tmp/project', 'fetch once', {
    model: 'claude-sonnet-4-6',
    permissionMode: 'ask-write',
  })

  expect(approvals).toHaveLength(1)
  await service.approve(approvals[0]!.id, 'accept')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(approvals).toHaveLength(2)
  await service.approve(approvals[1]!.id, 'accept')
  await turnPromise

  expect(toolResults).toEqual([
    { behavior: 'allow', toolUseID: 'tool-1' },
    { behavior: 'allow', toolUseID: 'tool-2' },
  ])
})

it('forwards approved Claude tool input metadata into tool progress and completion notifications', async () => {
  const service = new ClaudeChatService(new ProviderSessionDirectory())
  const approvals = captureApprovals(service)
  const notifications = captureNotifications(service)

  vi.mocked(query).mockImplementation(
    ((input: { options?: ClaudeQueryOptions }) =>
      ({
        interrupt: vi.fn(async () => undefined),
        async *[Symbol.asyncIterator]() {
          const canUseTool = input.options?.canUseTool
          if (!canUseTool) {
            return
          }
          await canUseTool(
            'Bash',
            { command: 'pnpm exec vitest run src/app.test.ts' },
            { signal: new AbortController().signal, toolUseID: 'tool-bash-1' }
          )
          yield {
            type: 'tool_progress',
            uuid: 'progress-1',
            session_id: 'claude-thread-1',
            tool_use_id: 'tool-bash-1',
            tool_name: 'Bash',
            parent_tool_use_id: null,
            elapsed_time_seconds: 0.5,
          }
          yield {
            type: 'tool_use_summary',
            uuid: 'summary-1',
            session_id: 'claude-thread-1',
            summary: 'Tests passed',
            preceding_tool_use_ids: ['tool-bash-1'],
          }
        },
      }) as never)
  )

  const turnPromise = service.startTurn('session-tools', '/tmp/project', 'run tests', {
    model: 'claude-sonnet-4-6',
    permissionMode: 'ask-write',
  })

  expect(approvals).toHaveLength(1)
  await service.approve(approvals[0]!.id, 'accept')
  await turnPromise

  expect(notifications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: 'tool/progress',
        params: expect.objectContaining({
          toolInput: { command: 'pnpm exec vitest run src/app.test.ts' },
        }),
      }),
      expect.objectContaining({
        method: 'tool/completed',
        params: expect.objectContaining({
          toolInput: { command: 'pnpm exec vitest run src/app.test.ts' },
        }),
      }),
    ])
  )
})
