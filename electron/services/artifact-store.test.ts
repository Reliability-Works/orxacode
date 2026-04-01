/** @vitest-environment node */

import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(() => '/tmp/orxa-code-test'),
}))

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
  },
}))

import { ArtifactStore } from './artifact-store'

const MB = 1024 * 1024

describe('ArtifactStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('applies retention cap and prunes oldest file artifacts', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'orxa-artifacts-'))
    tempDirs.push(rootDir)
    const store = new ArtifactStore({ rootDir })

    await store.writeImageArtifact({
      workspace: '/workspace/demo',
      sessionID: 'session-a',
      mime: 'image/png',
      buffer: Buffer.alloc(3 * MB, 1),
    })
    await store.writeImageArtifact({
      workspace: '/workspace/demo',
      sessionID: 'session-a',
      mime: 'image/png',
      buffer: Buffer.alloc(3 * MB, 2),
    })
    await store.writeImageArtifact({
      workspace: '/workspace/demo',
      sessionID: 'session-a',
      mime: 'image/png',
      buffer: Buffer.alloc(3 * MB, 3),
    })

    const before = await store.getRetentionPolicy()
    expect(before.totalBytes).toBeGreaterThan(8 * MB)

    const updated = await store.setRetentionPolicy({ maxBytes: 8 * MB })
    expect(updated.maxBytes).toBe(8 * MB)
    expect(updated.totalBytes).toBeLessThanOrEqual(8 * MB)

    const records = await store.list({ workspace: '/workspace/demo', limit: 20 })
    expect(records.length).toBeLessThan(3)
  })

  it('exports workspace artifact bundle with manifest and copied files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'orxa-artifacts-export-'))
    tempDirs.push(rootDir)
    const store = new ArtifactStore({ rootDir })

    await store.writeImageArtifact({
      workspace: '/workspace/export',
      sessionID: 'session-export',
      mime: 'image/jpeg',
      buffer: Buffer.from('image-export-binary'),
      title: 'Screenshot',
    })
    await store.writeContextSelectionArtifact({
      workspace: '/workspace/export',
      sessionID: 'session-export',
      trace: {
        id: 'trace-1',
        workspace: '/workspace/export',
        sessionID: 'session-export',
        query: 'draft launch summary',
        mode: 'hybrid_lexical_v1',
        selected: [],
        createdAt: Date.now(),
      },
    })

    const result = await store.exportBundle({
      workspace: '/workspace/export',
      sessionID: 'session-export',
      limit: 50,
    })

    expect(result.exportedArtifacts).toBe(2)
    expect(result.copiedFiles).toBe(1)
    await expect(stat(result.bundlePath)).resolves.toBeDefined()
    const manifestRaw = await readFile(result.manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw) as { records?: Array<{ bundleFile?: string }> }
    expect(Array.isArray(manifest.records)).toBe(true)
    expect(manifest.records?.some(item => typeof item.bundleFile === 'string')).toBe(true)
  })
})
