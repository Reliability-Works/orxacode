import { expect, it } from 'vitest'
import { projectOpencodeSessionPresentation } from './opencode-session-presentation'
import { createSessionMessageBundle } from '../test/session-message-bundle-factory'

it('hydrates provenance-backed changed files with session diff content and keeps them after command rows', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-1',
              callID: 'call-1',
              tool: 'bash',
              state: {
                status: 'completed',
                input: {
                  cmd: 'mkdir -p salon-booking && cd salon-booking && npm init -y',
                },
                output: '',
                title: 'bash',
                metadata: {},
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      changeProvenance: [
        {
          filePath: 'salon-booking/package.json',
          operation: 'edit',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'turn-1',
          eventID: 'prov-1',
          timestamp: now + 2,
          reason: 'Edited salon-booking/package.json',
        },
      ],
      sessionDiff: [
        {
          file: 'salon-booking/package.json',
          before: '',
          after: '{"name":"salon-booking"}\n{"private":true}\n{"scripts":{"dev":"next dev"}}',
          additions: 3,
          deletions: 0,
          status: 'added',
        },
      ],
      sessionStatus: { type: 'idle' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    const toolIndex = presentation.rows.findIndex(
      row =>
        row.kind === 'tool' &&
        row.title === 'Ran mkdir -p salon-booking && cd salon-booking && npm init -y'
    )
    const diffIndex = presentation.rows.findIndex(row => row.kind === 'diff-group')

    expect(toolIndex).toBeGreaterThanOrEqual(0)
    expect(diffIndex).toBeGreaterThan(toolIndex)
    expect(presentation.rows[diffIndex]).toMatchObject({
      kind: 'diff-group',
      files: [
        expect.objectContaining({
          path: 'salon-booking/package.json',
          diff: expect.stringContaining('+{"scripts":{"dev":"next dev"}}'),
          insertions: 3,
        }),
      ],
    })
})

it('keeps failed opencode command rows collapsed by default', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-1',
              callID: 'call-1',
              tool: 'bash',
              state: {
                status: 'error',
                input: {
                  cmd: 'npm install',
                },
                output: '',
                error: 'install failed',
                title: 'bash',
                metadata: {},
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      sessionStatus: { type: 'idle' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          title: 'Command failed npm install',
          expandedTitle: 'Command failed',
          status: 'error',
          defaultExpanded: false,
        }),
      ])
    )
})

it('uses specific failure wording for failed write rows', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-1',
              callID: 'call-1',
              tool: 'write',
              state: {
                status: 'error',
                input: { filePath: '/repo/the-gentlemans-cut/package.json' },
                output: '',
                error: 'must read first',
                title: 'write',
                metadata: {},
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      sessionStatus: { type: 'error', message: 'must read first' } as never,
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          title: 'Write failed the-gentlemans-cut/package.json',
          status: 'error',
        }),
      ])
    )
})

it('renders completed todo tools as lightweight status rows instead of command cards', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-todo-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-todo-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-todo-1',
              callID: 'call-todo-1',
              tool: 'todo_write',
              state: {
                status: 'completed',
                input: { todos: [{ content: 'Create app', status: 'completed' }] },
                output: '',
                title: 'todo_write',
                metadata: {},
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      sessionStatus: { type: 'idle' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'status',
          label: 'Updated todo list',
        }),
      ])
    )
    expect(
      presentation.rows.some(row => row.kind === 'tool' && row.title === 'Updated todo list')
    ).toBe(false)
})

it('replaces placeholder zero stats with the real session diff once it is available', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-1',
              callID: 'call-1',
              tool: 'write',
              state: {
                status: 'completed',
                input: { filePath: '/repo/salon-booking/app/api/stripe/webhook/route.ts' },
                output: '',
                title: 'write',
                metadata: {
                  filepath: '/repo/salon-booking/app/api/stripe/webhook/route.ts',
                  diff: {
                    path: 'salon-booking/app/api/stripe/webhook/route.ts',
                    insertions: 0,
                    deletions: 0,
                  },
                },
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      sessionDiff: [
        {
          file: 'salon-booking/app/api/stripe/webhook/route.ts',
          before: '',
          after: "import Stripe from 'stripe';\nexport async function POST() {}",
          additions: 2,
          deletions: 0,
          status: 'added',
        },
      ],
      sessionStatus: { type: 'idle' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'diff-group',
          files: [
            expect.objectContaining({
              path: 'salon-booking/app/api/stripe/webhook/route.ts',
              insertions: 2,
              deletions: 0,
              diff: expect.stringContaining("+import Stripe from 'stripe';"),
            }),
          ],
        }),
      ])
    )
})

it('filters bare directory placeholder provenance rows instead of rendering them as edited files', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [],
        }),
      ],
      changeProvenance: [
        {
          filePath: 'barbershop-booking',
          operation: 'edit',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'turn-1',
          eventID: 'prov-dir',
          timestamp: now + 1,
          reason: 'Patch update',
        },
        {
          filePath: 'salon-booking/.gitignore',
          operation: 'edit',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'turn-1',
          eventID: 'prov-file',
          timestamp: now + 2,
          reason: 'Edited salon-booking/.gitignore',
        },
      ],
      sessionDiff: [
        {
          file: 'salon-booking/.gitignore',
          before: '',
          after: 'node_modules',
          additions: 1,
          deletions: 0,
          status: 'added',
        },
      ],
      sessionStatus: { type: 'idle' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    const diffGroups = presentation.rows.filter(row => row.kind === 'diff-group')
    expect(diffGroups).toHaveLength(1)
    expect(diffGroups[0]).toMatchObject({
      kind: 'diff-group',
      files: [
        expect.objectContaining({
          path: 'salon-booking/.gitignore',
        }),
      ],
    })
    expect(JSON.stringify(diffGroups[0])).not.toContain('barbershop-booking')
})

it('keeps changed files inline while the session is still busy', () => {
    const now = Date.now()
    const presentation = projectOpencodeSessionPresentation({
      messages: [
        createSessionMessageBundle({
          id: 'turn-1',
          role: 'assistant',
          sessionID: 'session-1',
          createdAt: now,
          parts: [
            {
              id: 'tool-1',
              type: 'tool',
              sessionID: 'session-1',
              messageID: 'turn-1',
              callID: 'call-1',
              tool: 'write',
              state: {
                status: 'completed',
                input: { filePath: '/repo/barbershop-booking/package.json' },
                output: '',
                title: 'write',
                metadata: {},
                time: { start: now, end: now + 1 },
              },
            },
          ],
        }),
      ],
      changeProvenance: [
        {
          filePath: 'barbershop-booking/package.json',
          operation: 'edit',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'turn-1',
          eventID: 'prov-1',
          timestamp: now + 2,
          reason: 'Edited barbershop-booking/package.json',
        },
      ],
      sessionDiff: [
        {
          file: 'barbershop-booking/package.json',
          before: '',
          after: '{"name":"barbershop-booking"}',
          additions: 1,
          deletions: 0,
          status: 'added',
        },
      ],
      sessionStatus: { type: 'busy' },
      workspaceDirectory: '/repo',
      assistantLabel: 'Builder',
    })

    expect(presentation.rows.some(row => row.kind === 'diff-group')).toBe(false)
    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool-group',
          title: 'Tool calls',
          files: expect.arrayContaining([
            expect.objectContaining({
              path: 'barbershop-booking/package.json',
              diff: expect.stringContaining('+{"name":"barbershop-booking"}'),
            }),
          ]),
        }),
      ])
    )
})
