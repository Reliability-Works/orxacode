/**
 * Unit tests for `listOpencodePrimaryAgents` covering happy-path discovery
 * across config + data dirs, dedupe (config wins), missing-dir tolerance,
 * frontmatter parsing, JSON variant, mode filtering, and malformed-frontmatter
 * resilience.
 *
 * Uses the `readDir` / `readFileText` test seams so it never touches the real
 * filesystem.
 *
 * @module opencodeAgents.test
 */
import { describe, expect, it } from 'vitest'

import { listOpencodePrimaryAgents } from './opencodeAgents'

interface InMemoryFs {
  readonly [absolutePath: string]: ReadonlyArray<{
    readonly name: string
    readonly content: string
  }>
}

function makeFs(input: InMemoryFs) {
  const readDir = async (path: string): Promise<ReadonlyArray<string>> => {
    const entries = input[path]
    if (!entries) {
      const error = new Error(`ENOENT ${path}`) as Error & { code?: string }
      error.code = 'ENOENT'
      throw error
    }
    return entries.map(entry => entry.name)
  }
  const readFileText = async (path: string): Promise<string> => {
    for (const dirEntries of Object.values(input)) {
      for (const entry of dirEntries) {
        const candidatePath = path.endsWith(entry.name) ? entry.name : entry.name
        // We accept any path ending with the entry name (the implementation
        // joins dir + name, so the lookup matches by suffix here for brevity).
        if (path.endsWith(`/${candidatePath}`) || path.endsWith(candidatePath)) {
          return entry.content
        }
      }
    }
    const error = new Error(`ENOENT ${path}`) as Error & { code?: string }
    error.code = 'ENOENT'
    throw error
  }
  return { readDir, readFileText }
}

const PRIMARY_MD = `---
description: Strategic Planning Consultant.
mode: primary
model: opencode/gpt-5
temperature: 0.1
---

# Plan
body
`

const SUBAGENT_MD = `---
description: Helper.
mode: subagent
---

body
`

const PRIMARY_JSON = JSON.stringify({
  mode: 'primary',
  name: 'Json Primary',
  description: 'A JSON-defined primary agent.',
})

const MALFORMED_MD = `not frontmatter at all`

describe('listOpencodePrimaryAgents', () => {
  it('returns primary md + json agents from the config dir, sorted by id', async () => {
    const { readDir, readFileText } = makeFs({
      '/cfg': [
        { name: 'plan.md', content: PRIMARY_MD },
        { name: 'helper.md', content: SUBAGENT_MD },
        { name: 'jsonbot.json', content: PRIMARY_JSON },
      ],
    })
    const agents = await listOpencodePrimaryAgents({
      configDir: '/cfg',
      dataDir: '/missing-data',
      readDir,
      readFileText,
    })
    expect(agents.map(agent => agent.id)).toEqual(['jsonbot', 'plan'])
    const plan = agents.find(agent => agent.id === 'plan')
    expect(plan?.mode).toBe('primary')
    expect(plan?.source).toBe('config')
    expect(plan?.description).toBe('Strategic Planning Consultant.')
    const json = agents.find(agent => agent.id === 'jsonbot')
    expect(json?.name).toBe('Json Primary')
    expect(json?.source).toBe('config')
  })

  it('tolerates missing data dir and missing config dir', async () => {
    const { readDir, readFileText } = makeFs({})
    const agents = await listOpencodePrimaryAgents({
      configDir: '/cfg',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    expect(agents).toEqual([])
  })

  it('dedupes by id with config dir winning over data dir', async () => {
    const dataPlan = `---\nmode: primary\ndescription: Old\n---\n`
    const configPlan = `---\nmode: primary\ndescription: New\n---\n`
    const { readDir, readFileText } = makeFs({
      '/cfg': [{ name: 'plan.md', content: configPlan }],
      '/data': [{ name: 'plan.md', content: dataPlan }],
    })
    const agents = await listOpencodePrimaryAgents({
      configDir: '/cfg',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    expect(agents).toHaveLength(1)
    expect(agents[0]?.source).toBe('config')
    expect(agents[0]?.description).toBe('New')
  })
})

describe('listOpencodePrimaryAgents edge cases', () => {
  it('skips files without frontmatter and warns', async () => {
    const warnings: Array<string> = []
    const { readDir, readFileText } = makeFs({
      '/cfg': [
        { name: 'broken.md', content: MALFORMED_MD },
        { name: 'plan.md', content: PRIMARY_MD },
      ],
    })
    const agents = await listOpencodePrimaryAgents({
      configDir: '/cfg',
      dataDir: '/data',
      readDir,
      readFileText,
      logWarning: message => warnings.push(message),
    })
    expect(agents.map(agent => agent.id)).toEqual(['plan'])
    expect(warnings.some(warning => warning.includes('frontmatter'))).toBe(true)
  })

  it('keeps only data-dir-sourced primaries when config dir is missing', async () => {
    const { readDir, readFileText } = makeFs({
      '/data': [
        { name: 'archived.md', content: PRIMARY_MD },
        { name: 'sub.md', content: SUBAGENT_MD },
      ],
    })
    const agents = await listOpencodePrimaryAgents({
      configDir: '/missing-cfg',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    expect(agents.map(agent => agent.id)).toEqual(['archived'])
    expect(agents[0]?.source).toBe('data')
  })
})
