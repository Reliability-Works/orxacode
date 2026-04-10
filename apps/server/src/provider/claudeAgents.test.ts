import { describe, expect, it } from 'vitest'

import { findDiscoveredClaudeAgentById } from './claudeAgents.ts'

interface InMemoryFs {
  readonly [absolutePath: string]: ReadonlyArray<{
    readonly name: string
    readonly content: string
  }>
}

function makeFs(input: InMemoryFs) {
  const readDir = async (dirPath: string): Promise<ReadonlyArray<string>> => {
    const entries = input[dirPath]
    if (!entries) {
      const error = new Error(`ENOENT ${dirPath}`) as Error & { code?: string }
      error.code = 'ENOENT'
      throw error
    }
    return entries.map(entry => entry.name)
  }

  const readFileText = async (filePath: string): Promise<string> => {
    for (const [dirPath, dirEntries] of Object.entries(input)) {
      for (const entry of dirEntries) {
        if (filePath === `${dirPath}/${entry.name}`) {
          return entry.content
        }
      }
    }
    const error = new Error(`ENOENT ${filePath}`) as Error & { code?: string }
    error.code = 'ENOENT'
    throw error
  }

  return { readDir, readFileText }
}

const USER_EXPLORER = `---
name: explorer
description: Read-only repo explorer
model: opus
---

Explore carefully.
`

const PROJECT_EXPLORER = `---
name: explorer
description: Project override explorer
model: sonnet
---

Project-specific explorer.
`

const INHERIT_AGENT = `---
name: debugger
description: Debug things
model: inherit
---

Debug carefully.
`

describe('findDiscoveredClaudeAgentById', () => {
  it('resolves built-in Explore when no custom file exists', async () => {
    const { readDir, readFileText } = makeFs({})
    const agent = await findDiscoveredClaudeAgentById('Explore', {
      projectRoot: '/project',
      userAgentsDir: '/user/.claude/agents',
      readDir,
      readFileText,
    })
    expect(agent).toMatchObject({
      id: 'Explore',
      name: 'Explore',
      model: 'haiku',
      source: 'builtin',
    })
  })

  it('prefers project agents over user agents', async () => {
    const { readDir, readFileText } = makeFs({
      '/user/.claude/agents': [{ name: 'explorer.md', content: USER_EXPLORER }],
      '/project/.claude/agents': [{ name: 'explorer.md', content: PROJECT_EXPLORER }],
    })
    const agent = await findDiscoveredClaudeAgentById('explorer', {
      projectRoot: '/project',
      userAgentsDir: '/user/.claude/agents',
      readDir,
      readFileText,
    })
    expect(agent).toMatchObject({
      id: 'explorer',
      name: 'Explorer',
      model: 'sonnet',
      source: 'project',
    })
  })

  it('returns inherit model metadata from markdown frontmatter', async () => {
    const { readDir, readFileText } = makeFs({
      '/project/.claude/agents': [{ name: 'debugger.md', content: INHERIT_AGENT }],
    })
    const agent = await findDiscoveredClaudeAgentById('debugger', {
      projectRoot: '/project',
      userAgentsDir: '/user/.claude/agents',
      readDir,
      readFileText,
    })
    expect(agent).toMatchObject({
      id: 'debugger',
      name: 'Debugger',
      model: 'inherit',
      source: 'project',
    })
  })
})
