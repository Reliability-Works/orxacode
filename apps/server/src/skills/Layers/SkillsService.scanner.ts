/**
 * Filesystem scanner for {@link SkillsServiceLive}.
 *
 * Walks a root directory looking for any sub-directory that contains a
 * `SKILL.md` file. Each matching directory becomes one skill entry. The scan
 * is shallow by convention — only one level of nesting is supported, so a
 * skills root might look like:
 *
 *   ~/.codex/skills/
 *     refactor-with-tests/
 *       SKILL.md
 *     commit-message/
 *       SKILL.md
 *
 * Unreadable roots and missing SKILL.md files are silently skipped.
 *
 * @module SkillsService.scanner
 */
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import type { Skill, SkillProvider } from '@orxa-code/contracts'

import { parseSkillMd } from './SkillsService.parser.ts'

const SKILL_FILENAME = 'SKILL.md'

async function readSkillMd(skillDir: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(path.join(skillDir, SKILL_FILENAME), 'utf-8')
  } catch {
    return null
  }
}

async function getMtimeIso(filePath: string): Promise<string> {
  try {
    const stats = await fsPromises.stat(filePath)
    return stats.mtime.toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

async function buildSkill(skillDir: string, provider: SkillProvider): Promise<Skill | null> {
  const content = await readSkillMd(skillDir)
  if (content === null) {
    return null
  }
  const id = path.basename(skillDir)
  const parsed = parseSkillMd(content, id)
  const skillFilePath = path.join(skillDir, SKILL_FILENAME)
  const updatedAt = await getMtimeIso(skillFilePath)

  if (parsed.name.length === 0 || id.length === 0) {
    return null
  }

  return {
    id,
    name: parsed.name,
    description: parsed.description,
    provider,
    source: 'filesystem',
    path: skillFilePath,
    tags: parsed.tags,
    updatedAt,
  }
}

export async function scanSkillRoot(
  rootPath: string,
  provider: SkillProvider
): Promise<ReadonlyArray<Skill>> {
  const skills: Skill[] = []
  try {
    const entries = await fsPromises.readdir(rootPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const skillDir = path.join(rootPath, entry.name)
      const skill = await buildSkill(skillDir, provider)
      if (skill) {
        skills.push(skill)
      }
    }
  } catch {
    // Root missing or unreadable — return empty.
  }
  return skills
}
