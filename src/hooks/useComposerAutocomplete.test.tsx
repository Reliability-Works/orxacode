import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerAutocomplete } from './useComposerAutocomplete'

function mockSkill(id: string, path: string, description = 'Skill description') {
  return {
    id,
    name: id
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    description,
    path,
  }
}

function renderAutocomplete(
  overrides: Partial<Parameters<typeof useComposerAutocomplete>[0]> = {}
) {
  return renderHook(() =>
    useComposerAutocomplete({
      provider: 'codex',
      directory: '/repo',
      composer: '/',
      setComposer: vi.fn(),
      availableSlashCommands: [],
      ...overrides,
    })
  )
}

function registerCodexSkillTests() {
  it('loads provider-specific codex skills for slash suggestions', async () => {
    vi.mocked(window.orxa.app.listSkillsFromDir).mockResolvedValue([
      mockSkill('frontend-design', '/Users/callumspencer/.codex/skills/frontend-design'),
    ])

    const { result } = renderAutocomplete({ provider: 'codex', composer: '/front' })

    await waitFor(() => {
      expect(result.current.filteredSlashCommands).toEqual([
        expect.objectContaining({
          name: 'frontend-design',
          trigger: '/',
          kind: 'skill',
        }),
      ])
    })

    expect(window.orxa.app.listSkillsFromDir).toHaveBeenCalledWith('~/.codex/skills')
  })

  it('combines slash commands with loaded skills', async () => {
    vi.mocked(window.orxa.app.listSkillsFromDir).mockResolvedValue([
      mockSkill('frontend-design', '/Users/callumspencer/.codex/skills/frontend-design'),
    ])

    const { result } = renderAutocomplete({
      provider: 'codex',
      composer: '/',
      availableSlashCommands: [{ name: 'model', description: 'Select a model' }],
    })

    await waitFor(() => {
      expect(result.current.filteredSlashCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'model', kind: 'command', trigger: '/' }),
          expect.objectContaining({ name: 'frontend-design', kind: 'skill', trigger: '/' }),
        ])
      )
    })
  })
}

function registerClaudeSkillTests() {
  it('loads provider-specific Claude skills for slash suggestions', async () => {
    vi.mocked(window.orxa.app.listSkillsFromDir).mockResolvedValue([
      mockSkill('spec-writer', '/Users/callumspencer/.claude/skills/spec-writer'),
    ])

    const { result } = renderAutocomplete({ provider: 'claude', composer: '/spec' })

    await waitFor(() => {
      expect(result.current.filteredSlashCommands).toEqual([
        expect.objectContaining({
          name: 'spec-writer',
          trigger: '/',
          kind: 'skill',
        }),
      ])
    })

    expect(window.orxa.app.listSkillsFromDir).toHaveBeenCalledWith('~/.claude/skills')
  })
}

function registerOpencodeSkillTests() {
  it('loads OpenCode skills from the provider-specific source', async () => {
    vi.mocked(window.orxa.opencode.listSkills).mockResolvedValue([
      mockSkill('frontend-design', '/Users/callumspencer/.config/opencode/skill/frontend-design'),
    ])

    const { result } = renderAutocomplete({ provider: 'opencode', composer: '/' })

    await waitFor(() => {
      expect(window.orxa.opencode.listSkills).toHaveBeenCalled()
      expect(result.current.filteredSlashCommands).toEqual([
        expect.objectContaining({
          name: 'frontend-design',
          trigger: '/',
          kind: 'skill',
        }),
      ])
    })
  })
}

function registerWorkspaceFileTests() {
  it('loads workspace files for @ suggestions and inserts the selected path', async () => {
    vi.mocked(window.orxa.opencode.listFiles).mockImplementation(
      async (_directory: string, relativePath?: string) => {
        if (!relativePath) {
          return [
            {
              name: 'src',
              path: '/repo/src',
              relativePath: 'src',
              type: 'directory',
              hasChildren: true,
            },
            {
              name: 'README.md',
              path: '/repo/README.md',
              relativePath: 'README.md',
              type: 'file',
            },
          ]
        }
        if (relativePath === 'src') {
          return [
            {
              name: 'App.tsx',
              path: '/repo/src/App.tsx',
              relativePath: 'src/App.tsx',
              type: 'file',
            },
          ]
        }
        return []
      }
    )

    const setComposer = vi.fn()
    const { result } = renderAutocomplete({
      provider: 'claude',
      composer: 'check @app',
      setComposer,
    })

    await waitFor(() => {
      expect(result.current.filteredSlashCommands).toEqual([
        expect.objectContaining({
          name: 'src/App.tsx',
          trigger: '@',
          kind: 'file',
        }),
      ])
    })

    result.current.insertSlashCommand(result.current.filteredSlashCommands[0]!)

    expect(setComposer).toHaveBeenCalledWith('check @src/App.tsx ')
  })
}

describe('useComposerAutocomplete', () => {
  beforeEach(() => {
    window.orxa = {
      app: {
        listSkillsFromDir: vi.fn(async () => []),
      },
      opencode: {
        listSkills: vi.fn(async () => []),
        listFiles: vi.fn(async () => []),
      },
    } as unknown as typeof window.orxa
  })

  registerCodexSkillTests()
  registerClaudeSkillTests()
  registerOpencodeSkillTests()
  registerWorkspaceFileTests()
})
