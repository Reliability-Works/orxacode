/**
 * WS handlers for `skills.*` RPCs.
 *
 * @module ws.skills
 */
import type { SkillListInput, SkillRefreshInput, SkillSetRootsInput } from '@orxa-code/contracts'
import { WS_METHODS } from '@orxa-code/contracts'

import type { SkillsService } from './skills/Services/SkillsService'

export interface SkillsMethodDependencies {
  readonly skillsService: typeof SkillsService.Service
}

export const createSkillsMethods = ({ skillsService }: SkillsMethodDependencies) => ({
  [WS_METHODS.skillsList]: (input: SkillListInput) => skillsService.list(input),
  [WS_METHODS.skillsRefresh]: (input: SkillRefreshInput) =>
    skillsService.refresh(input.provider !== undefined ? { provider: input.provider } : {}),
  [WS_METHODS.skillsGetRoots]: () => skillsService.getRoots(),
  [WS_METHODS.skillsSetRoots]: (input: SkillSetRootsInput) =>
    skillsService.setRoots({ roots: input.roots }),
})
