export type BrandAssetOverride = {
  readonly sourceRelativePath: string
  readonly targetRelativePath: string
}

/**
 * Asset overrides applied when embedding the web client into apps/server/dist/client
 * during local builds.
 */
export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<BrandAssetOverride> = []

/**
 * Asset overrides applied only for publish packaging.
 */
export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<BrandAssetOverride> = []
