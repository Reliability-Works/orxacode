import type {
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanTaskProviderConfig,
} from '@shared/ipc'

export function buildTaskFieldRegenerationPrompt(input: {
  workspaceDir: string
  provider: KanbanProvider
  field: KanbanRegenerateTaskField
  title: string
  description: string
  prompt: string
}) {
  return [
    'You are improving a Kanban task definition for a coding agent.',
    `Workspace: ${input.workspaceDir}`,
    `Selected provider: ${input.provider}`,
    `Target field: ${input.field}`,
    'Return only the rewritten field text.',
    'Do not include quotes, markdown fences, labels, bullet points, or explanations.',
    "Preserve the user's intent, but make the field clearer, more specific, and more useful for execution.",
    input.field === 'title'
      ? 'For title: keep it concise, action-oriented, and under about 80 characters.'
      : input.field === 'description'
        ? 'For description: write 1-2 compact sentences explaining the task outcome clearly.'
        : 'For prompt: write a strong execution-ready prompt with concrete scope, output expectations, and useful constraints.',
    '',
    'Current task:',
    `Title: ${input.title || '(empty)'}`,
    `Description: ${input.description || '(empty)'}`,
    `Prompt: ${input.prompt || '(empty)'}`,
  ].join('\n')
}

export function extractGeneratedFieldText(output: string) {
  const trimmed = output.trim()
  if (!trimmed) {
    return ''
  }
  const fencedMatch = trimmed.match(/```(?:text)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1]?.trim() || trimmed
  return candidate.replace(/^["'`](.*)["'`]$/s, '$1').trim()
}

export function buildRunAgentCliOptions(input: {
  provider: KanbanProvider
  providerConfig: KanbanTaskProviderConfig | undefined
  workspaceDir: string
  prompt: string
}) {
  if (input.provider === 'opencode') {
    const model = input.providerConfig?.opencode?.model
      ? `${input.providerConfig.opencode.model.providerID}/${input.providerConfig.opencode.model.modelID}`
      : undefined
    return {
      agent: 'opencode' as const,
      cwd: input.workspaceDir,
      prompt: input.prompt,
      model,
      opencodeAgent: input.providerConfig?.opencode?.agent,
      variant: input.providerConfig?.opencode?.variant,
    }
  }
  if (input.provider === 'codex') {
    return {
      agent: 'codex' as const,
      cwd: input.workspaceDir,
      prompt: input.prompt,
      model: input.providerConfig?.codex?.model,
      effort: input.providerConfig?.codex?.reasoningEffort,
    }
  }
  return {
    agent: 'claude' as const,
    cwd: input.workspaceDir,
    prompt: input.prompt,
    model: input.providerConfig?.claude?.model,
    effort: input.providerConfig?.claude?.effort,
    permissionMode: 'acceptEdits',
  }
}
