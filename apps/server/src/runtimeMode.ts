/**
 * Runtime mode helpers. The desktop shell sets `ORXA_PACKAGED=1` in the
 * backend child env when Electron's `app.isPackaged` is true; everything else
 * (pnpm dev, tests, CLI) sees `0` or unset and is treated as dev.
 */

export function isPackagedBuild(): boolean {
  return process.env.ORXA_PACKAGED === '1'
}

export function isDevBuild(): boolean {
  return !isPackagedBuild()
}
