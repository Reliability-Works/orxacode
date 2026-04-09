/**
 * SkillsServiceLive — live implementation of {@link SkillsService}.
 *
 * Maintains an in-memory skill cache per provider, backed by filesystem scans.
 * The cache is warm on construction (first list call scans lazily) and
 * invalidated when `refresh()` is called. Roots config is persisted to
 * `<stateDir>/skills-roots.json` so user-added roots survive restarts.
 *
 * @module SkillsServiceLive
 */
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import type { Skill, SkillListResult, SkillRootsConfig } from '@orxa-code/contracts'
import { SkillReadError } from '@orxa-code/contracts'
import { Effect, Layer, Ref } from 'effect'

import { ServerConfig } from '../../config.ts'
import { SkillsService, type SkillsServiceShape } from '../Services/SkillsService.ts'
import { scanSkillRoot } from './SkillsService.scanner.ts'
import { defaultSkillRoots } from './SkillsService.roots.ts'

const ROOTS_FILENAME = 'skills-roots.json'

async function loadRootsFromDisk(rootsPath: string): Promise<SkillRootsConfig> {
  try {
    const raw = await fsPromises.readFile(rootsPath, 'utf-8')
    return JSON.parse(raw) as SkillRootsConfig
  } catch {
    return defaultSkillRoots()
  }
}

async function saveRootsToDisk(rootsPath: string, roots: SkillRootsConfig): Promise<void> {
  await fsPromises.mkdir(path.dirname(rootsPath), { recursive: true })
  await fsPromises.writeFile(rootsPath, JSON.stringify(roots, null, 2), 'utf-8')
}

async function scanAllRoots(roots: SkillRootsConfig): Promise<ReadonlyArray<Skill>> {
  const all: Skill[] = []
  const allRoots = [...roots.codex, ...roots.claudeAgent, ...roots.opencode]
  for (const root of allRoots) {
    const skills = await scanSkillRoot(root.path, root.provider)
    all.push(...skills)
  }
  return all
}

function applySearch(skills: ReadonlyArray<Skill>, search: string): ReadonlyArray<Skill> {
  const lower = search.toLowerCase()
  return skills.filter(
    s =>
      s.name.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower) ||
      s.tags.some(t => t.toLowerCase().includes(lower))
  )
}

function buildResult(
  skills: ReadonlyArray<Skill>,
  input: { provider?: Skill['provider']; search?: string }
): SkillListResult {
  let filtered = input.provider ? skills.filter(s => s.provider === input.provider) : skills
  if (input.search && input.search.length > 0) {
    filtered = applySearch(filtered, input.search)
  }
  const updatedAt = skills.length > 0 ? skills[0]!.updatedAt : new Date(0).toISOString()
  return { skills: filtered, updatedAt }
}

const makeSkillsService = Effect.gen(function* () {
  const config = yield* ServerConfig
  const rootsPath = path.join(config.stateDir, ROOTS_FILENAME)

  const rootsRef = yield* Ref.make<SkillRootsConfig>(defaultSkillRoots())
  const cacheRef = yield* Ref.make<ReadonlyArray<Skill> | null>(null)

  // Shared: load roots from disk, update both refs, return scanned skills.
  const scanAndCache = Effect.gen(function* () {
    const roots = yield* Effect.tryPromise(() => loadRootsFromDisk(rootsPath))
    yield* Ref.set(rootsRef, roots)
    const skills = yield* Effect.tryPromise(() => scanAllRoots(roots))
    yield* Ref.set(cacheRef, skills)
    return skills
  })

  const getOrLoad = Ref.get(cacheRef).pipe(
    Effect.flatMap(cached => (cached !== null ? Effect.succeed(cached) : scanAndCache))
  )

  const list: SkillsServiceShape['list'] = ({ provider, search }) =>
    getOrLoad.pipe(
      Effect.map(skills =>
        buildResult(skills, {
          ...(provider !== undefined ? { provider } : {}),
          ...(search !== undefined ? { search } : {}),
        })
      ),
      Effect.mapError(
        cause =>
          new SkillReadError({
            operation: 'skills.list',
            path: '',
            detail: 'Failed to scan skill roots',
            cause,
          })
      )
    )

  const refresh: SkillsServiceShape['refresh'] = input =>
    scanAndCache.pipe(
      Effect.map(skills =>
        buildResult(skills, input.provider !== undefined ? { provider: input.provider } : {})
      ),
      Effect.mapError(
        cause =>
          new SkillReadError({
            operation: 'skills.refresh',
            path: '',
            detail: 'Failed to refresh skill roots',
            cause,
          })
      )
    )

  const getRoots: SkillsServiceShape['getRoots'] = () =>
    Ref.get(rootsRef).pipe(Effect.map(roots => ({ roots })))

  const setRoots: SkillsServiceShape['setRoots'] = ({ roots }) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() => saveRootsToDisk(rootsPath, roots))
      yield* Ref.set(rootsRef, roots)
      yield* Ref.set(cacheRef, null)
      return { roots }
    }).pipe(
      Effect.mapError(
        cause =>
          new SkillReadError({
            operation: 'skills.setRoots',
            path: rootsPath,
            detail: 'Failed to save skill roots',
            cause,
          })
      )
    )

  return { list, refresh, getRoots, setRoots } satisfies SkillsServiceShape
})

export const SkillsServiceLive = Layer.effect(SkillsService, makeSkillsService)
