import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

export function canonicalRuntimeMessages(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-1',
      uuid: 'stream-0',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-1',
      uuid: 'stream-1',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-1',
      uuid: 'stream-2',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 0 },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-1',
      uuid: 'stream-3',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-1',
      uuid: 'stream-4',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 1 },
    } as unknown as SDKMessage,
    {
      type: 'assistant',
      session_id: 'sdk-session-1',
      uuid: 'assistant-1',
      parent_tool_use_id: null,
      message: { id: 'assistant-message-1', content: [{ type: 'text', text: 'Hi' }] },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-1',
      uuid: 'result-1',
    } as unknown as SDKMessage,
  ]
}

export function earlyAssistantWithLateDeltaMessages(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'assistant',
      session_id: 'sdk-session-early-assistant',
      uuid: 'assistant-early',
      parent_tool_use_id: null,
      message: {
        id: 'assistant-message-early',
        content: [{ type: 'tool_use', id: 'tool-early', name: 'Read', input: { path: 'a.ts' } }],
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-early-assistant',
      uuid: 'stream-early',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Late text' },
      },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-early-assistant',
      uuid: 'result-early',
    } as unknown as SDKMessage,
  ]
}

export function reusedTextIndexMessages(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-start-1',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-delta-1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'First' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-stop-1',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 0 },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-start-2',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-delta-2',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Second' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-reused-text-index',
      uuid: 'stream-reused-stop-2',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 0 },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-reused-text-index',
      uuid: 'result-reused-text-index',
    } as unknown as SDKMessage,
  ]
}

export function fallbackAssistantTextMessages(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'assistant',
      session_id: 'sdk-session-fallback-text',
      uuid: 'assistant-fallback',
      parent_tool_use_id: null,
      message: {
        id: 'assistant-message-fallback',
        content: [{ type: 'text', text: 'Fallback hello' }],
      },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-fallback-text',
      uuid: 'result-fallback',
    } as unknown as SDKMessage,
  ]
}

function interleavedFirstTextBlock(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-1-start',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-1-delta',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'First message.' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-1-stop',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 0 },
    } as unknown as SDKMessage,
  ]
}

function interleavedToolCallBlock(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-tool-start',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'tool-interleaved-1',
          name: 'Grep',
          input: { pattern: 'assistant', path: 'src' },
        },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-tool-stop',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 1 },
    } as unknown as SDKMessage,
    {
      type: 'user',
      session_id: 'sdk-session-interleaved',
      uuid: 'user-tool-result-interleaved',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-interleaved-1',
            content: 'src/example.ts:1:assistant',
          },
        ],
      },
    } as unknown as SDKMessage,
  ]
}

function interleavedSecondTextBlock(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-2-start',
      parent_tool_use_id: null,
      event: { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-2-delta',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: 'Second message.' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-interleaved',
      uuid: 'stream-text-2-stop',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 2 },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-interleaved',
      uuid: 'result-interleaved',
    } as unknown as SDKMessage,
  ]
}

export function interleavedAssistantToolMessages(): ReadonlyArray<SDKMessage> {
  return [
    ...interleavedFirstTextBlock(),
    ...interleavedToolCallBlock(),
    ...interleavedSecondTextBlock(),
  ]
}

export function toolStreamMessages(): ReadonlyArray<SDKMessage> {
  return [
    {
      type: 'stream_event',
      session_id: 'sdk-session-tool-streams',
      uuid: 'stream-thinking',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-tool-streams',
      uuid: 'stream-tool-start',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tool-grep-1', name: 'Grep', input: {} },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-tool-streams',
      uuid: 'stream-tool-input-1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"pattern":"foo","path":"src"}' },
      },
    } as unknown as SDKMessage,
    {
      type: 'stream_event',
      session_id: 'sdk-session-tool-streams',
      uuid: 'stream-tool-stop',
      parent_tool_use_id: null,
      event: { type: 'content_block_stop', index: 1 },
    } as unknown as SDKMessage,
    {
      type: 'user',
      session_id: 'sdk-session-tool-streams',
      uuid: 'user-tool-result',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-grep-1', content: 'src/example.ts:1:foo' },
        ],
      },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      errors: [],
      session_id: 'sdk-session-tool-streams',
      uuid: 'result-tool-streams',
    } as unknown as SDKMessage,
  ]
}
