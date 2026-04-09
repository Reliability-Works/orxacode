/**
 * SkillsService — scan, list, and manage skill roots for the Skills board.
 *
 * Skills are SKILL.md files located under user-managed root directories, one
 * set of roots per provider. The service maintains an in-memory cache that is
 * invalidated by an explicit `refresh()` call. Roots are persisted to a JSON
 * file so user-added directories survive server restarts.
 *
 * @module SkillsService
 */
import type {
  Skill,
  SkillListInput,
  SkillListResult,
  SkillRefreshResult,
  SkillRootsConfig,
  SkillsServiceError,
} from '@orxa-code/contracts'
import { ServiceMap } from 'effect'
import type { Effect } from 'effect'

export interface SkillsServiceShape {
  readonly list: (input: SkillListInput) => Effect.Effect<SkillListResult, SkillsServiceError>
  readonly refresh: (input: {
    readonly provider?: Skill['provider']
  }) => Effect.Effect<SkillRefreshResult, SkillsServiceError>
  readonly getRoots: () => Effect.Effect<{ readonly roots: SkillRootsConfig }, SkillsServiceError>
  readonly setRoots: (input: {
    readonly roots: SkillRootsConfig
  }) => Effect.Effect<{ readonly roots: SkillRootsConfig }, SkillsServiceError>
}

export class SkillsService extends ServiceMap.Service<SkillsService, SkillsServiceShape>()(
  'orxacode/skills/Services/SkillsService'
) {}
