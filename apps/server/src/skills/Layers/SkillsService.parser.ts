/**
 * SKILL.md parser for {@link SkillsServiceLive}.
 *
 * Reads a minimal plain-text convention:
 *   - Line starting with `# ` → skill name
 *   - First non-empty, non-heading line → description
 *   - Line matching `tags: ...` (case-insensitive) → comma-separated tags
 *
 * Every field degrades gracefully to a sensible default so a bare SKILL.md
 * with zero front-matter still produces a valid skill entry.
 *
 * @module SkillsService.parser
 */

const TAG_LINE_PATTERN = /^tags\s*:\s*(.+)$/i

export interface ParsedSkillMd {
  readonly name: string
  readonly description: string
  readonly tags: ReadonlyArray<string>
}

function trimTag(tag: string): string {
  return tag.trim().replace(/^[,\s]+|[,\s]+$/g, '')
}

export function parseSkillMd(content: string, fallbackName: string): ParsedSkillMd {
  const lines = content.split('\n')
  let name = ''
  let description = ''
  const tags: string[] = []
  let passedFirstHeading = false

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (name.length === 0 && line.startsWith('# ')) {
      name = line.slice(2).trim()
      passedFirstHeading = true
      continue
    }

    const tagMatch = TAG_LINE_PATTERN.exec(line)
    if (tagMatch) {
      const parsed = tagMatch[1]!
        .split(',')
        .map(trimTag)
        .filter(t => t.length > 0)
      tags.push(...parsed)
      continue
    }

    if (
      description.length === 0 &&
      passedFirstHeading &&
      line.length > 0 &&
      !line.startsWith('#')
    ) {
      description = line.trim()
    }
  }

  return {
    name: name.length > 0 ? name : fallbackName,
    description,
    tags,
  }
}
