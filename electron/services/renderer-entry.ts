import path from 'node:path'

export function resolveRendererHtmlPath(mainProcessDir: string): string {
  return path.resolve(mainProcessDir, '../dist/index.html')
}
