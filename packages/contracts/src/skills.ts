import { Schema } from 'effect'

import { IsoDateTime, TrimmedNonEmptyString } from './baseSchemas'
import { ProviderKind } from './orchestration.models'

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

/**
 * Where a skill originated from. Today the only supported source is a
 * filesystem-backed `SKILL.md` directory under one of the provider skill roots.
 * The literal is kept open so we can add `'builtin' | 'remote'` later without
 * breaking the wire format.
 */
export const SkillSource = Schema.Literals(['filesystem'])
export type SkillSource = typeof SkillSource.Type

/**
 * The provider a skill is scoped to. Mirrors `ProviderKind` so we can reuse
 * existing `ProviderKind` helpers in the store without a separate literal.
 */
export const SkillProvider = ProviderKind
export type SkillProvider = typeof SkillProvider.Type

/**
 * A single skill entry surfaced in the Skills board. `id` is stable across
 * refreshes and is derived from the directory name; `path` is absolute and
 * only ever set for `source: 'filesystem'` skills.
 */
export const Skill = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  provider: SkillProvider,
  source: SkillSource,
  path: TrimmedNonEmptyString,
  tags: Schema.Array(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
})
export type Skill = typeof Skill.Type

/**
 * A single skill root directory. `editable: true` marks user-managed roots
 * that the Settings surface is allowed to mutate; defaults are read-only.
 */
export const SkillRoot = Schema.Struct({
  provider: SkillProvider,
  path: TrimmedNonEmptyString,
  editable: Schema.Boolean,
})
export type SkillRoot = typeof SkillRoot.Type

/**
 * The full set of skill roots, grouped by provider. Persisted in the desktop
 * settings store so a user can add custom directories without rebuilding.
 */
export const SkillRootsConfig = Schema.Struct({
  codex: Schema.Array(SkillRoot),
  claudeAgent: Schema.Array(SkillRoot),
  opencode: Schema.Array(SkillRoot),
})
export type SkillRootsConfig = typeof SkillRootsConfig.Type

// ---------------------------------------------------------------------------
// RPC inputs / results
// ---------------------------------------------------------------------------

export const SkillListInput = Schema.Struct({
  provider: Schema.optional(SkillProvider),
  search: Schema.optional(Schema.String),
})
export type SkillListInput = typeof SkillListInput.Type

export const SkillListResult = Schema.Struct({
  skills: Schema.Array(Skill),
  updatedAt: IsoDateTime,
})
export type SkillListResult = typeof SkillListResult.Type

export const SkillRefreshInput = Schema.Struct({
  provider: Schema.optional(SkillProvider),
})
export type SkillRefreshInput = typeof SkillRefreshInput.Type

export const SkillRefreshResult = SkillListResult
export type SkillRefreshResult = typeof SkillRefreshResult.Type

export const SkillGetRootsInput = Schema.Struct({})
export type SkillGetRootsInput = typeof SkillGetRootsInput.Type

export const SkillGetRootsResult = Schema.Struct({
  roots: SkillRootsConfig,
})
export type SkillGetRootsResult = typeof SkillGetRootsResult.Type

export const SkillSetRootsInput = Schema.Struct({
  roots: SkillRootsConfig,
})
export type SkillSetRootsInput = typeof SkillSetRootsInput.Type

export const SkillSetRootsResult = SkillGetRootsResult
export type SkillSetRootsResult = typeof SkillSetRootsResult.Type

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SkillReadError extends Schema.TaggedErrorClass<SkillReadError>()('SkillReadError', {
  operation: Schema.String,
  path: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Skill read failed in ${this.operation} at ${this.path}: ${this.detail}`
  }
}

export class SkillRootRejectedError extends Schema.TaggedErrorClass<SkillRootRejectedError>()(
  'SkillRootRejectedError',
  {
    path: Schema.String,
    reason: Schema.String,
  }
) {
  override get message(): string {
    return `Skill root rejected: ${this.path} (${this.reason})`
  }
}

export const SkillsServiceError = Schema.Union([SkillReadError, SkillRootRejectedError])
export type SkillsServiceError = typeof SkillsServiceError.Type
