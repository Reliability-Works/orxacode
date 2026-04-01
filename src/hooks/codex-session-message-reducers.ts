import type { TodoItem } from '../components/chat/TodoDock'
import type { CodexMessageItem } from './codex-session-types'

export function appendDeltaToMappedItem(
  prev: CodexMessageItem[],
  msgID: string,
  field: 'content' | 'output' | 'diff' | 'summary',
  delta: string
): CodexMessageItem[] {
  const idx = prev.findIndex(m => m.id === msgID)
  if (idx < 0) {
    return prev
  }
  const item = prev[idx]
  const updated = { ...item }
  if (field === 'content' && 'content' in updated) {
    ;(updated as { content: string }).content += delta
  } else if (field === 'output' && 'output' in updated) {
    ;(updated as { output?: string }).output =
      ((updated as { output?: string }).output ?? '') + delta
  } else if (field === 'diff' && 'diff' in updated) {
    ;(updated as { diff?: string }).diff = ((updated as { diff?: string }).diff ?? '') + delta
  } else if (field === 'summary' && 'summary' in updated) {
    ;(updated as { summary: string }).summary += delta
  }
  const next = [...prev]
  next[idx] = updated as CodexMessageItem
  return next
}

export function appendAssistantDeltaToLastMessage(
  prev: CodexMessageItem[],
  delta: string
): CodexMessageItem[] {
  if (prev.length === 0) {
    return prev
  }
  const last = prev[prev.length - 1]
  if (last.kind !== 'message' || last.role !== 'assistant') {
    return prev
  }
  return [...prev.slice(0, -1), { ...last, content: last.content + delta }]
}

export function removeMessageByID(prev: CodexMessageItem[], id: string): CodexMessageItem[] {
  return prev.filter(message => message.id !== id)
}

export function parseMarkdownPlan(text: string): TodoItem[] {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- ') || line.startsWith('* ') || /^\d+[.)]\s/.test(line))
  return lines.map((line, index) => ({
    id: `plan-${index}`,
    content: line
      .replace(/^\s*[-*]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim(),
    status: 'pending' as const,
  }))
}

export function extractPlanStepContent(step: Record<string, unknown>): string {
  for (const key of [
    'content',
    'title',
    'text',
    'description',
    'step',
    'name',
    'summary',
    'label',
    'task',
  ]) {
    const value = step[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  for (const value of Object.values(step)) {
    if (typeof value === 'string' && value.trim().length > 3) {
      return value.trim()
    }
  }
  return JSON.stringify(step)
}

export function parseStructuredPlan(plan: unknown): TodoItem[] {
  if (!Array.isArray(plan) || plan.length === 0) {
    return []
  }
  return plan.map((step: unknown, index: number) => {
    if (typeof step === 'string') {
      return { id: `plan-${index}`, content: step, status: 'pending' as const }
    }
    if (step && typeof step === 'object') {
      const record = step as Record<string, unknown>
      const statusRaw = String(record.status ?? 'pending')
      const status: TodoItem['status'] =
        statusRaw === 'completed'
          ? 'completed'
          : statusRaw === 'in_progress' || statusRaw === 'inProgress'
            ? 'in_progress'
            : statusRaw === 'cancelled'
              ? 'cancelled'
              : 'pending'
      return {
        id: String(record.id ?? `plan-${index}`),
        content: extractPlanStepContent(record),
        status,
      }
    }
    return { id: `plan-${index}`, content: String(step), status: 'pending' as const }
  })
}
