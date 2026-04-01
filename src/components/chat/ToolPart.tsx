import type { JSX } from 'react'
import { BashTool } from './BashTool'
import { EditTool } from './EditTool'
import { ContextToolGroup, type ContextToolItem } from './ContextToolGroup'
import { ToolCallCard, type ToolCallStatus } from './ToolCallCard'

export interface ToolChange {
  path: string
  type?: string
  diff?: string
  insertions?: number
  deletions?: number
}

interface ToolPartProps {
  toolName: string
  status: string
  title?: string
  input?: unknown
  output?: string
  error?: string
  command?: string
  exitCode?: number
  changes?: ToolChange[]
}

// Safely extract a string property from an unknown object
function getString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key]
    if (typeof val === 'string') return val
  }
  return undefined
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key]
    if (typeof val === 'number') return val
  }
  return undefined
}

// Tools that display as single-line context items
const CONTEXT_TOOLS = new Set([
  'read',
  'list',
  'glob',
  'grep',
  'codesearch',
  'webfetch',
  'websearch',
])

// Tools that display with BashTool
const BASH_TOOLS = new Set(['bash', 'shell', 'command'])

// Tools that display with EditTool
const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch'])

function toSafeStatus(status: string): ToolCallStatus {
  return (
    ['pending', 'running', 'completed', 'error'].includes(status) ? status : 'pending'
  ) as ToolCallStatus
}

function renderTodoWrite(input: unknown, status: string): JSX.Element {
  const safeStatus = toSafeStatus(status)
  let todos: Array<{ content: string; status?: string }> = []

  if (input && typeof input === 'object') {
    const inp = input as Record<string, unknown>
    if (Array.isArray(inp['todos'])) {
      todos = inp['todos'] as Array<{ content: string; status?: string }>
    }
  }

  return (
    <div className={`todo-checklist tool-call-card tool-call-card--${safeStatus}`}>
      <div className="tool-call-card-header">
        <span
          className={`tool-call-card-status tool-call-card-status--${safeStatus}`}
          aria-label={status}
        />
        <span className="tool-call-card-title">Tasks</span>
      </div>
      {todos.length > 0 ? (
        <ul className="todo-checklist-list">
          {todos.map((todo, i) => {
            const isDone = todo.status === 'completed' || todo.status === 'done'
            return (
              <li
                key={i}
                className={`todo-checklist-item${isDone ? ' todo-checklist-item--done' : ''}`}
              >
                <span className="todo-checklist-checkbox" aria-hidden="true">
                  {isDone ? '✓' : '○'}
                </span>
                <span className="todo-checklist-content">{todo.content}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function renderQuestion(input: unknown, status: string): JSX.Element {
  const safeStatus = toSafeStatus(status)
  const question = getString(input, 'question') ?? getString(input, 'prompt') ?? 'Question'

  return (
    <div className={`question-display tool-call-card tool-call-card--${safeStatus}`}>
      <div className="tool-call-card-header">
        <span
          className={`tool-call-card-status tool-call-card-status--${safeStatus}`}
          aria-label={status}
        />
        <span className="tool-call-card-title question-display-text">{question}</span>
      </div>
    </div>
  )
}

// Derive collab operation label from the title/name
function collabOperationLabel(
  title: string | undefined,
  status: string
): { label: string; detail: string } {
  const raw = (title ?? '').toLowerCase()
  if (raw.includes('collab: spawn') || raw.includes('spawn')) {
    return {
      label: 'Spawning agent',
      detail: status === 'completed' ? 'Agent spawned' : 'Spawning agent...',
    }
  }
  if (raw.includes('collab: send') || raw.includes('send')) {
    return {
      label: 'Sent to agent',
      detail: status === 'completed' ? 'Sent to agent' : 'Sending to agent...',
    }
  }
  if (raw.includes('collab: wait') || raw.includes('wait')) {
    return {
      label: 'Waiting for agent',
      detail: status === 'completed' ? 'Agent responded' : 'Waiting for agent...',
    }
  }
  if (raw.includes('collab: close') || raw.includes('close')) {
    return {
      label: 'Closing agent',
      detail: status === 'completed' ? 'Agent closed' : 'Closing agent...',
    }
  }
  return { label: 'Task', detail: status === 'completed' ? 'Task completed' : 'Running task...' }
}

function renderTask(input: unknown, status: string, output?: string, title?: string): JSX.Element {
  const safeStatus = toSafeStatus(status)
  const description =
    getString(input, 'description') ?? getString(input, 'prompt') ?? 'Delegated task'

  // Detect collab tool calls and enhance rendering
  const isCollab = (title ?? '').toLowerCase().startsWith('collab')
  const collabInfo = isCollab ? collabOperationLabel(title, status) : null

  // Extract receiver nickname if available
  const receiver =
    input && typeof input === 'object'
      ? (getString((input as Record<string, unknown>).collabReceiver as unknown, 'nickname') ??
        getString(input, 'receiverNickname'))
      : undefined

  return (
    <div className={`task-card tool-call-card tool-call-card--${safeStatus}`}>
      <div className="tool-call-card-header">
        <span
          className={`tool-call-card-status tool-call-card-status--${safeStatus}`}
          aria-label={status}
        />
        <span className="tool-call-card-title">{collabInfo?.label ?? 'Task'}</span>
        <span className="tool-call-card-subtitle">
          {collabInfo ? collabInfo.detail : description}
          {receiver ? ` \u2014 ${receiver}` : ''}
        </span>
      </div>
      {output ? (
        <div className="tool-call-card-body">
          <pre className="tool-call-card-output">{output}</pre>
        </div>
      ) : null}
    </div>
  )
}

type ToolPartVariant = 'bash' | 'edit' | 'context' | 'todo' | 'question' | 'task' | 'fallback'

function renderBashPart({
  command,
  input,
  output,
  exitCode,
  status,
  error,
  title,
  toolName,
}: {
  command?: string
  input: unknown
  output?: string
  exitCode?: number
  status: string
  error?: string
  title?: string
  toolName: string
}) {
  const cmd = command ?? getString(input, 'command') ?? getString(input, 'cmd') ?? title ?? toolName
  return (
    <BashTool
      command={cmd}
      output={output}
      exitCode={exitCode ?? getNumber(input, 'exitCode')}
      status={status}
      error={error}
    />
  )
}

function renderEditPart({
  changes,
  input,
  status,
  error,
  title,
  toolName,
}: {
  changes?: ToolChange[]
  input: unknown
  status: string
  error?: string
  title?: string
  toolName: string
}) {
  if (changes && changes.length > 0) {
    return (
      <div className="tool-part edit-tool-group">
        {changes.map((change, i) => (
          <EditTool
            key={i}
            path={change.path}
            status={status}
            diff={change.diff}
            insertions={change.insertions}
            deletions={change.deletions}
            type={change.type}
            error={error}
          />
        ))}
      </div>
    )
  }

  const path =
    getString(input, 'path') ??
    getString(input, 'file_path') ??
    getString(input, 'filename') ??
    title ??
    toolName

  return (
    <EditTool
      path={path}
      status={status}
      diff={getString(input, 'diff')}
      insertions={getNumber(input, 'insertions')}
      deletions={getNumber(input, 'deletions')}
      type={getString(input, 'type')}
      error={error}
    />
  )
}

function renderContextPart({
  input,
  output,
  status,
  title,
  toolName,
}: {
  input: unknown
  output?: string
  status: string
  title?: string
  toolName: string
}) {
  const itemTitle =
    title ??
    getString(input, 'path') ??
    getString(input, 'file_path') ??
    getString(input, 'pattern') ??
    getString(input, 'query') ??
    getString(input, 'url') ??
    toolName

  const item: ContextToolItem = {
    toolName,
    title: itemTitle,
    status,
    detail: output ? `${output.length} chars` : undefined,
  }

  return <ContextToolGroup items={[item]} />
}

function resolveToolPartVariant(name: string): ToolPartVariant {
  if (BASH_TOOLS.has(name)) return 'bash'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (CONTEXT_TOOLS.has(name)) return 'context'
  if (name === 'todowrite' || name === 'todoread') return 'todo'
  if (name === 'question') return 'question'
  if (name === 'task' || name === 'agent') return 'task'
  return 'fallback'
}

export function ToolPart({
  toolName,
  status,
  title,
  input,
  output,
  error,
  command,
  exitCode,
  changes,
}: ToolPartProps) {
  const name = toolName.toLowerCase()
  const variant = resolveToolPartVariant(name)

  switch (variant) {
    case 'bash':
      return renderBashPart({ command, input, output, exitCode, status, error, title, toolName })
    case 'edit':
      return renderEditPart({ changes, input, status, error, title, toolName })
    case 'context':
      return renderContextPart({ input, output, status, title, toolName })
    case 'todo':
      return renderTodoWrite(input, status)
    case 'question':
      return renderQuestion(input, status)
    case 'task':
      return renderTask(input, status, output, title)
    default: {
      const safeStatus = toSafeStatus(status)
      return (
        <ToolCallCard
          title={title ?? toolName}
          status={safeStatus}
          output={output}
          error={error}
          defaultExpanded={false}
        />
      )
    }
  }
}
