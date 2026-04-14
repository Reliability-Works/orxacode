export const APP_BASE_NAME = 'Orxa Code'
export const APP_VERSION = import.meta.env.APP_VERSION || '0.0.0'
export const APP_IS_PRERELEASE = /-[0-9A-Za-z]/.test(APP_VERSION)
export const APP_STAGE_LABEL = APP_IS_PRERELEASE ? 'Beta' : null
export const APP_DISPLAY_NAME = APP_IS_PRERELEASE
  ? `${APP_BASE_NAME} (${APP_STAGE_LABEL})`
  : APP_BASE_NAME
