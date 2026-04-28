import { describe, expect, it } from 'vitest'
import { buildLegacyClientSettingsMigrationPatch } from './useSettings'

describe('buildLegacyClientSettingsMigrationPatch', () => {
  it('migrates delete confirmation from legacy local settings', () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadDelete: true,
      })
    ).toEqual({
      confirmThreadDelete: true,
    })
  })
})
