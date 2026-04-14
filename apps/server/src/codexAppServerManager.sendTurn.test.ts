import { expect, it, vi } from 'vitest'

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from './codexAppServerManager'
import { asThreadId, createSendTurnHarness } from './codexAppServerManager.test.helpers'

it('sends text and image user input items to turn/start', async () => {
  const { manager, context, requireSession, sendRequest, updateSession } = createSendTurnHarness()

  const result = await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'Inspect this image',
    attachments: [
      {
        type: 'image',
        url: 'data:image/png;base64,AAAA',
      },
    ],
    model: 'gpt-5.3',
    serviceTier: 'fast',
    effort: 'high',
  })

  expect(result).toEqual({
    threadId: 'thread_1',
    turnId: 'turn_1',
    resumeCursor: { threadId: 'thread_1' },
  })
  expect(requireSession).toHaveBeenCalledWith('thread_1')
  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/start', {
    threadId: 'thread_1',
    input: [
      {
        type: 'text',
        text: 'Inspect this image',
        text_elements: [],
      },
      {
        type: 'image',
        url: 'data:image/png;base64,AAAA',
      },
    ],
    model: 'gpt-5.3-codex',
    serviceTier: 'fast',
    effort: 'high',
  })
  expect(updateSession).toHaveBeenCalledWith(context, {
    status: 'running',
    activeTurnId: 'turn_1',
    resumeCursor: { threadId: 'thread_1' },
  })
})

it('supports image-only turns', async () => {
  const { manager, context, sendRequest } = createSendTurnHarness()

  await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    attachments: [
      {
        type: 'image',
        url: 'data:image/png;base64,BBBB',
      },
    ],
  })

  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/start', {
    threadId: 'thread_1',
    input: [
      {
        type: 'image',
        url: 'data:image/png;base64,BBBB',
      },
    ],
    model: 'gpt-5.3-codex',
  })
})

it('passes Codex plan mode as a collaboration preset on turn/start', async () => {
  const { manager, context, sendRequest } = createSendTurnHarness()

  await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'Plan the work',
    interactionMode: 'plan',
  })

  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/start', {
    threadId: 'thread_1',
    input: [
      {
        type: 'text',
        text: 'Plan the work',
        text_elements: [],
      },
    ],
    model: 'gpt-5.3-codex',
    collaborationMode: {
      mode: 'plan',
      settings: {
        model: 'gpt-5.3-codex',
        reasoning_effort: 'medium',
        developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
      },
    },
  })
})

it('passes Codex default mode as a collaboration preset on turn/start', async () => {
  const { manager, context, sendRequest } = createSendTurnHarness()

  await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'PLEASE IMPLEMENT THIS PLAN:\n- step 1',
    interactionMode: 'default',
  })

  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/start', {
    threadId: 'thread_1',
    input: [
      {
        type: 'text',
        text: 'PLEASE IMPLEMENT THIS PLAN:\n- step 1',
        text_elements: [],
      },
    ],
    model: 'gpt-5.3-codex',
    collaborationMode: {
      mode: 'default',
      settings: {
        model: 'gpt-5.3-codex',
        reasoning_effort: 'medium',
        developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      },
    },
  })
})

it('keeps the session model when interaction mode is set without an explicit model', async () => {
  const { manager, context, sendRequest } = createSendTurnHarness()
  context.session.model = 'gpt-5.2-codex'

  await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'Plan this with my current session model',
    interactionMode: 'plan',
  })

  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/start', {
    threadId: 'thread_1',
    input: [
      {
        type: 'text',
        text: 'Plan this with my current session model',
        text_elements: [],
      },
    ],
    model: 'gpt-5.2-codex',
    collaborationMode: {
      mode: 'plan',
      settings: {
        model: 'gpt-5.2-codex',
        reasoning_effort: 'medium',
        developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
      },
    },
  })
})

it('steers the active turn when one is running instead of starting a new one', async () => {
  const { manager, context, sendRequest, updateSession } = createSendTurnHarness()
  context.session.status = 'running'
  context.session.activeTurnId = 'turn_active'

  const result = await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'Also, look at this file',
  })

  expect(sendRequest).toHaveBeenCalledTimes(1)
  expect(sendRequest).toHaveBeenCalledWith(context, 'turn/steer', {
    threadId: 'thread_1',
    input: [
      {
        type: 'text',
        text: 'Also, look at this file',
        text_elements: [],
      },
    ],
    expectedTurnId: 'turn_active',
  })
  expect(result).toEqual({
    threadId: 'thread_1',
    turnId: 'turn_active',
    resumeCursor: { threadId: 'thread_1' },
  })
  // Steer does not change the active turn — no status transition needed.
  expect(updateSession).not.toHaveBeenCalled()
})

it('falls back to turn/start when the CLI does not know turn/steer', async () => {
  const { manager, context } = createSendTurnHarness()
  context.session.status = 'running'
  context.session.activeTurnId = 'turn_active'

  const sendRequest = vi
    .spyOn(
      manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
      'sendRequest'
    )
    .mockImplementationOnce(() => {
      const err = new Error('turn/steer failed: Method not found') as Error & { code?: number }
      err.code = -32601
      return Promise.reject(err)
    })
    .mockResolvedValueOnce({ turn: { id: 'turn_new' } })

  const result = await manager.sendTurn({
    threadId: asThreadId('thread_1'),
    input: 'Also, look at this file',
  })

  expect(sendRequest).toHaveBeenNthCalledWith(
    1,
    context,
    'turn/steer',
    expect.objectContaining({ expectedTurnId: 'turn_active' })
  )
  expect(sendRequest).toHaveBeenNthCalledWith(
    2,
    context,
    'turn/start',
    expect.objectContaining({ threadId: 'thread_1' })
  )
  expect(result).toEqual({
    threadId: 'thread_1',
    turnId: 'turn_new',
    resumeCursor: { threadId: 'thread_1' },
  })
})

it('propagates steer errors other than method-not-found (e.g. non-steerable turn)', async () => {
  const { manager, context } = createSendTurnHarness()
  context.session.status = 'running'
  context.session.activeTurnId = 'turn_active'

  vi.spyOn(
    manager as unknown as { sendRequest: (...args: unknown[]) => Promise<unknown> },
    'sendRequest'
  ).mockRejectedValueOnce(
    Object.assign(new Error('turn/steer failed: active turn is not steerable'), { code: -32602 })
  )

  await expect(
    manager.sendTurn({
      threadId: asThreadId('thread_1'),
      input: 'Also, look at this file',
    })
  ).rejects.toThrow('active turn is not steerable')
})

it('rejects empty turn input', async () => {
  const { manager } = createSendTurnHarness()

  await expect(
    manager.sendTurn({
      threadId: asThreadId('thread_1'),
    })
  ).rejects.toThrow('Turn input must include text or attachments.')
})
