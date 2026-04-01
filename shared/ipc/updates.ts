export type UpdateReleaseChannel = 'stable' | 'prerelease'

export type UpdatePreferences = {
  autoCheckEnabled: boolean
  releaseChannel: UpdateReleaseChannel
}

export type UpdateCheckResult = {
  ok: boolean
  status: 'started' | 'skipped' | 'error'
  message?: string
}
