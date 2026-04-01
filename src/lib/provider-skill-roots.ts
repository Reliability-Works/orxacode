export type SkillProvider = 'opencode' | 'codex' | 'claude'

export const PROVIDER_SKILL_ROOTS: Record<SkillProvider, string> = {
  opencode: '~/.config/opencode/skill',
  codex: '~/.codex/skills',
  claude: '~/.claude/skills',
}
