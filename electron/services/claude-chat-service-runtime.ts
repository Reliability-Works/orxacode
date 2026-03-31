import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Options as ClaudeQueryOptions, PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeChatAttachment,
  ClaudeChatHealthStatus,
  ClaudeChatModelEntry,
  ClaudeChatTurnOptions,
} from '@shared/ipc'

export const CLAUDE_MODELS: ClaudeChatModelEntry[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    isDefault: false,
    supportsFastMode: true,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'max', 'ultrathink'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    isDefault: true,
    supportsFastMode: false,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'ultrathink'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    isDefault: false,
    supportsFastMode: false,
    supportsThinkingToggle: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  },
]

export const CLAUDE_HEALTH_CACHE_TTL_MS = 10_000
const CLAUDE_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])
const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const

function supportsClaudeFastMode(model: string | null | undefined) {
  return model?.trim() === 'claude-opus-4-6'
}

function supportsClaudeAdaptiveReasoning(model: string | null | undefined) {
  const normalized = model?.trim()
  return normalized === 'claude-opus-4-6' || normalized === 'claude-sonnet-4-6'
}

function supportsClaudeMaxEffort(model: string | null | undefined) {
  return model?.trim() === 'claude-opus-4-6'
}

export function mapPermissionMode(input: string | undefined): PermissionMode | undefined {
  if (input === 'plan') return 'plan'
  if (input === 'yolo-write') return 'bypassPermissions'
  if (input === 'ask-write') return 'default'
  return undefined
}

function normalizeClaudeImageMime(mime: string | undefined) {
  const normalized = mime?.trim().toLowerCase() ?? ''
  return CLAUDE_SUPPORTED_IMAGE_MIME_TYPES.has(normalized)
    ? (normalized as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
    : null
}

function parseImageDataUrl(
  url: string
): { mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(url)
  if (!match) return null
  const mime = normalizeClaudeImageMime(match[1])
  return mime ? { mime, data: match[2]!.trim() } : null
}

async function attachmentToClaudeImageBlock(attachment: ClaudeChatAttachment) {
  const inlineData = parseImageDataUrl(attachment.url)
  if (inlineData) {
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: inlineData.mime,
        data: inlineData.data,
      },
    }
  }

  const mime = normalizeClaudeImageMime(attachment.mime)
  if (!mime) {
    throw new Error(`Unsupported Claude image attachment type: ${attachment.mime || 'unknown'}`)
  }

  const filePath =
    attachment.path?.trim() ||
    (attachment.url.startsWith('file:') ? fileURLToPath(attachment.url) : '')
  if (!filePath) {
    throw new Error(`Claude image attachment is missing file data for ${attachment.filename}`)
  }

  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mime,
      data: (await readFile(filePath)).toString('base64'),
    },
  }
}

export async function* buildClaudePromptStream(
  sessionId: string,
  prompt: string,
  attachments: ClaudeChatAttachment[]
) {
  const content: Array<
    | Awaited<ReturnType<typeof attachmentToClaudeImageBlock>>
    | { type: 'text'; text: string }
  > = await Promise.all(attachments.map(attachment => attachmentToClaudeImageBlock(attachment)))

  if (prompt.trim().length > 0) {
    content.push({ type: 'text', text: prompt })
  }

  yield {
    type: 'user' as const,
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      role: 'user' as const,
      content,
    },
  }
}

export async function runClaudeCommand(args: string[]) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const result = await execFileAsync('claude', args, {
    timeout: 15_000,
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export async function fetchClaudeHealth(): Promise<ClaudeChatHealthStatus> {
  try {
    const version = await runClaudeCommand(['--version'])
    const versionLine = `${version.stdout}\n${version.stderr}`.trim().split(/\r?\n/)[0]?.trim()
    try {
      const auth = await runClaudeCommand(['auth', 'status'])
      const combined = `${auth.stdout}\n${auth.stderr}`.trim()
      const parsed =
        combined.startsWith('{') || combined.startsWith('[')
          ? (JSON.parse(combined) as Record<string, unknown>)
          : null
      const normalized = combined.toLowerCase()
      const authenticated =
        parsed && typeof parsed.loggedIn === 'boolean'
          ? parsed.loggedIn
          : normalized.includes('not authenticated') ||
              normalized.includes('not logged in') ||
              normalized.includes('login required')
            ? false
            : normalized.includes('authenticated') || normalized.includes('logged in')
              ? true
              : null
      return {
        available: true,
        authenticated,
        version: versionLine,
        message: authenticated === null ? combined || undefined : undefined,
      }
    } catch (error) {
      return {
        available: true,
        authenticated: null,
        version: versionLine,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  } catch (error) {
    return {
      available: false,
      authenticated: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function resolveClaudeEffort(
  model: string | undefined,
  requestedEffort: string | undefined
): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!requestedEffort || requestedEffort === 'ultrathink') {
    return undefined
  }
  const supportedEfforts = supportsClaudeMaxEffort(model)
    ? ['low', 'medium', 'high', 'max', 'ultrathink']
    : supportsClaudeAdaptiveReasoning(model)
      ? ['low', 'medium', 'high', 'ultrathink']
      : []
  return supportedEfforts.includes(requestedEffort)
    ? (requestedEffort as 'low' | 'medium' | 'high' | 'max')
    : undefined
}

export function readClaudeResumeCursor(resumeCursor: unknown) {
  if (!resumeCursor || typeof resumeCursor !== 'object' || Array.isArray(resumeCursor)) {
    return undefined
  }
  const normalized =
    typeof (resumeCursor as { resume?: unknown }).resume === 'string'
      ? (resumeCursor as { resume: string }).resume.trim()
      : ''
  return normalized || undefined
}

type ClaudeQueryOptionInputs = {
  canUseTool: ClaudeQueryOptions['canUseTool']
  directory: string
  effectiveEffort: 'low' | 'medium' | 'high' | 'max' | undefined
  onElicitation: (
    request: import('@anthropic-ai/claude-agent-sdk').ElicitationRequest
  ) => Promise<{
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
  }>
  options: ClaudeChatTurnOptions | undefined
  permissionMode: PermissionMode | undefined
  providerSessionId: string
  resumeSessionId: string | undefined
}

export function buildStartTurnQueryOptions({
  canUseTool,
  directory,
  effectiveEffort,
  onElicitation,
  options,
  permissionMode,
  providerSessionId,
  resumeSessionId,
}: ClaudeQueryOptionInputs): ClaudeQueryOptions {
  return {
    cwd: directory,
    model: options?.model,
    pathToClaudeCodeExecutable: 'claude',
    includePartialMessages: true,
    env: process.env,
    additionalDirectories: [directory],
    settingSources: [...CLAUDE_SETTING_SOURCES],
    ...(effectiveEffort ? { effort: effectiveEffort } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(typeof options?.maxThinkingTokens === 'number'
      ? { maxThinkingTokens: options.maxThinkingTokens }
      : {}),
    ...(typeof options?.thinking === 'boolean' || options?.fastMode
      ? {
          settings: {
            ...(typeof options?.thinking === 'boolean'
              ? { alwaysThinkingEnabled: options.thinking }
              : {}),
            ...(options?.fastMode && supportsClaudeFastMode(options?.model)
              ? { fastMode: true }
              : {}),
          },
        }
      : {}),
    ...(resumeSessionId ? { resume: resumeSessionId } : { sessionId: providerSessionId }),
    ...(canUseTool ? { canUseTool } : {}),
    onElicitation,
  }
}
