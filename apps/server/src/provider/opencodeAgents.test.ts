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

import { findDiscoveredOpencodeAgentById, listOpencodePrimaryAgents } from './opencodeAgents'

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
    for (const [dirPath, dirEntries] of Object.entries(input)) {
      for (const entry of dirEntries) {
        if (path === `${dirPath}/${entry.name}`) {
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
model: fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo
---

body
`

const PRIMARY_JSON = JSON.stringify({
  mode: 'primary',
  name: 'Json Primary',
  description: 'A JSON-defined primary agent.',
})

const CONFIG_JSON = JSON.stringify({
  agent: {
    builder: {
      mode: 'primary',
      model: 'openai/gpt-5.4',
      description: 'Build things',
    },
    explorer: {
      mode: 'subagent',
      model: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
      description: 'Explore the codebase',
    },
  },
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

  it('can resolve subagent definitions by id with model metadata', async () => {
    const { readDir, readFileText } = makeFs({
      '/cfg': [{ name: 'explorer.md', content: SUBAGENT_MD }],
    })
    const agent = await findDiscoveredOpencodeAgentById('explorer', {
      configDir: '/cfg',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    expect(agent).toMatchObject({
      id: 'explorer',
      mode: 'subagent',
      model: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
      source: 'config',
    })
  })
})

describe('opencode agent config discovery', () => {
  it('discovers agents from opencode.json', async () => {
    const { readDir, readFileText } = makeFs({
      '/cfg': [{ name: 'review.md', content: PRIMARY_MD }],
      '/config-root': [{ name: 'opencode.json', content: CONFIG_JSON }],
    })
    const builder = await findDiscoveredOpencodeAgentById('builder', {
      configDir: '/cfg',
      configFilePath: '/config-root/opencode.json',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    const explorer = await findDiscoveredOpencodeAgentById('explorer', {
      configDir: '/cfg',
      configFilePath: '/config-root/opencode.json',
      dataDir: '/data',
      readDir,
      readFileText,
    })
    expect(builder).toMatchObject({
      id: 'builder',
      mode: 'primary',
      model: 'openai/gpt-5.4',
    })
    expect(explorer).toMatchObject({
      id: 'explorer',
      mode: 'subagent',
      model: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
    })
  })

  it('lets project-local config override global agent definitions', async () => {
    const globalConfig = JSON.stringify({
      agent: {
        explorer: {
          mode: 'subagent',
          model: 'openai/gpt-5.4',
          description: 'Global explorer',
        },
      },
    })
    const projectConfig = JSON.stringify({
      agent: {
        explorer: {
          mode: 'subagent',
          model: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
          description: 'Project explorer',
        },
      },
    })
    const { readDir, readFileText } = makeFs({
      '/config-root': [{ name: 'opencode.json', content: globalConfig }],
      '/project': [{ name: 'opencode.json', content: projectConfig }],
      '/project/.opencode/agents': [{ name: 'helper.md', content: SUBAGENT_MD }],
    })
    const agent = await findDiscoveredOpencodeAgentById('explorer', {
      configDir: '/cfg',
      configFilePath: '/config-root/opencode.json',
      dataDir: '/data',
      projectRoot: '/project',
      readDir,
      readFileText,
    })
    expect(agent).toMatchObject({
      id: 'explorer',
      model: 'fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo',
      description: 'Project explorer',
    })
  })
})
