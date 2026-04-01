export type ProviderCommandProvider = 'claude' | 'codex'

export type ProviderCommandCategory =
  | 'session'
  | 'context'
  | 'model'
  | 'review'
  | 'integrations'
  | 'project'

export type ProviderCommandStatus = 'mapped' | 'planned' | 'reference'

export type ProviderCommandEntry = {
  name: string
  description: string
  category: ProviderCommandCategory
  status: ProviderCommandStatus
  orxaEquivalent?: string
}

export type ProviderCommandCatalog = {
  provider: ProviderCommandProvider
  title: string
  subtitle: string
  note: string
  source: string
  commands: ProviderCommandEntry[]
}

const CLAUDE_COMMAND_CATALOG: ProviderCommandCatalog = {
  provider: 'claude',
  title: 'Claude native commands',
  subtitle: 'Curated Claude Code commands that matter in Orxa as a desktop ADE.',
  note:
    'These are native Claude Code command references. Orxa does not execute Claude slash commands directly yet; use the mapped Orxa controls where shown.',
  source: 'Anthropic Claude Code shipped command surface',
  commands: [
    {
      name: 'resume',
      description: 'Resume a previous conversation.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Claude session browser',
    },
    {
      name: 'clear',
      description: 'Clear conversation history and free up context.',
      category: 'session',
      status: 'reference',
    },
    {
      name: 'compact',
      description: 'Compact the conversation to free context.',
      category: 'context',
      status: 'planned',
      orxaEquivalent: 'Compaction indicator exists; manual compact action is still missing',
    },
    {
      name: 'plan',
      description: 'Enable plan mode or view the current session plan.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Plan mode toggle',
    },
    {
      name: 'model',
      description: 'Set the Claude model for the current session.',
      category: 'model',
      status: 'mapped',
      orxaEquivalent: 'Model picker',
    },
    {
      name: 'effort',
      description: 'Set the reasoning effort level.',
      category: 'model',
      status: 'mapped',
      orxaEquivalent: 'Claude traits picker',
    },
    {
      name: 'permissions',
      description: 'Manage allow and deny tool permission rules.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Permission mode control',
    },
    {
      name: 'diff',
      description: 'View uncommitted changes and per-turn diffs.',
      category: 'review',
      status: 'mapped',
      orxaEquivalent: 'Git sidebar and review-changes dock',
    },
    {
      name: 'memory',
      description: 'Edit Claude memory files.',
      category: 'context',
      status: 'planned',
    },
    {
      name: 'hooks',
      description: 'View hook configurations for tool events.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'mcp',
      description: 'Manage MCP servers.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'skills',
      description: 'List available skills.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'agents',
      description: 'Manage agent configurations.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'files',
      description: 'List all files currently in context.',
      category: 'project',
      status: 'reference',
    },
    {
      name: 'doctor',
      description: 'Diagnose the Claude Code installation and settings.',
      category: 'project',
      status: 'reference',
    },
    {
      name: 'cost',
      description: 'Show total cost and duration of the current session.',
      category: 'review',
      status: 'reference',
    },
    {
      name: 'help',
      description: 'Show help and available commands.',
      category: 'project',
      status: 'reference',
    },
  ],
}

const CODEX_COMMAND_CATALOG: ProviderCommandCatalog = {
  provider: 'codex',
  title: 'Codex native commands',
  subtitle: 'Curated Codex commands from the official CLI docs, filtered for Orxa.',
  note:
    'These are native Codex command references. Orxa does not execute Codex slash commands directly yet; use the mapped Orxa controls where shown.',
  source: 'OpenAI Codex CLI slash command docs',
  commands: [
    {
      name: 'resume',
      description: 'Resume a saved conversation from your session list.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Codex thread browser',
    },
    {
      name: 'new',
      description: 'Start a new conversation inside the same Codex session.',
      category: 'session',
      status: 'reference',
    },
    {
      name: 'clear',
      description: 'Clear the terminal and start a fresh chat.',
      category: 'session',
      status: 'reference',
    },
    {
      name: 'compact',
      description: 'Summarize the conversation to free tokens.',
      category: 'context',
      status: 'planned',
      orxaEquivalent: 'Compaction indicator exists; manual compact action is still missing',
    },
    {
      name: 'plan',
      description: 'Switch the current conversation into plan mode.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Plan mode toggle',
    },
    {
      name: 'permissions',
      description: 'Set what Codex can do without asking first.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Permission mode control',
    },
    {
      name: 'model',
      description: 'Choose the active model and reasoning effort.',
      category: 'model',
      status: 'mapped',
      orxaEquivalent: 'Model picker and reasoning selector',
    },
    {
      name: 'fast',
      description: 'Toggle Fast mode for GPT-5.4.',
      category: 'model',
      status: 'planned',
    },
    {
      name: 'agent',
      description: 'Switch the active agent thread.',
      category: 'session',
      status: 'mapped',
      orxaEquivalent: 'Background agent thread controls',
    },
    {
      name: 'diff',
      description: 'Show the Git diff, including untracked files.',
      category: 'review',
      status: 'mapped',
      orxaEquivalent: 'Git sidebar and review-changes dock',
    },
    {
      name: 'review',
      description: 'Ask Codex to review your working tree.',
      category: 'review',
      status: 'reference',
    },
    {
      name: 'status',
      description: 'Display session configuration and token usage.',
      category: 'review',
      status: 'planned',
    },
    {
      name: 'mcp',
      description: 'List configured MCP tools.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'apps',
      description: 'Browse apps and insert them into your prompt.',
      category: 'integrations',
      status: 'planned',
    },
    {
      name: 'mention',
      description: 'Attach a file or folder to the conversation.',
      category: 'project',
      status: 'reference',
    },
    {
      name: 'fork',
      description: 'Fork the current conversation into a new thread.',
      category: 'session',
      status: 'planned',
    },
    {
      name: 'init',
      description: 'Generate an AGENTS.md scaffold in the current directory.',
      category: 'project',
      status: 'reference',
    },
    {
      name: 'help',
      description: 'Show help and available commands.',
      category: 'project',
      status: 'reference',
    },
  ],
}

export function getProviderCommandCatalog(provider: ProviderCommandProvider): ProviderCommandCatalog {
  return provider === 'claude' ? CLAUDE_COMMAND_CATALOG : CODEX_COMMAND_CATALOG
}
