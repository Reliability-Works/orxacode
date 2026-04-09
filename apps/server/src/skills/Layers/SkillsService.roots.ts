/**
 * Default skill root resolution for {@link SkillsServiceLive}.
 *
 * Provides a sensible starting set of roots without requiring any user
 * configuration. Users can add or remove roots via `skills.setRoots`.
 *
 * @module SkillsService.roots
 */
import path from 'node:path'

import type { SkillRoot, SkillRootsConfig } from '@orxa-code/contracts'

function homeDir(): string {
  return process.env.HOME ?? ''
}

function codexSkillsRoot(): SkillRoot {
  const codexHome = process.env.CODEX_HOME?.trim()
  const dir =
    codexHome && codexHome.length > 0
      ? path.join(codexHome, 'skills')
      : path.join(homeDir(), '.codex', 'skills')
  return { provider: 'codex', path: dir, editable: false }
}

function claudeSkillsRoot(): SkillRoot {
  return {
    provider: 'claudeAgent',
    path: path.join(homeDir(), '.claude', 'skills'),
    editable: false,
  }
}

export function defaultSkillRoots(): SkillRootsConfig {
  return {
    codex: [codexSkillsRoot()],
    claudeAgent: [claudeSkillsRoot()],
    opencode: [],
  }
}
