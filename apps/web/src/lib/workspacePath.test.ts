import { describe, expect, it } from 'vitest'

import { relativizeWorkspacePathsInText, toWorkspaceRelativePath } from './workspacePath'

describe('toWorkspaceRelativePath', () => {
  it('strips the workspace root prefix', () => {
    expect(toWorkspaceRelativePath('/Users/cal/repo/src/index.ts', '/Users/cal/repo')).toBe(
      'src/index.ts'
    )
  })

  it('returns "." when the path equals the workspace root', () => {
    expect(toWorkspaceRelativePath('/Users/cal/repo', '/Users/cal/repo')).toBe('.')
  })

  it('tolerates a trailing slash on the workspace root', () => {
    expect(toWorkspaceRelativePath('/Users/cal/repo/app.ts', '/Users/cal/repo/')).toBe('app.ts')
  })

  it('returns the original path when workspaceRoot is undefined', () => {
    expect(toWorkspaceRelativePath('/Users/cal/repo/app.ts', undefined)).toBe(
      '/Users/cal/repo/app.ts'
    )
  })

  it('returns the original path when the path is outside the workspace', () => {
    expect(toWorkspaceRelativePath('/tmp/other/file.ts', '/Users/cal/repo')).toBe(
      '/tmp/other/file.ts'
    )
  })

  it('does not strip when only a sibling directory shares a prefix', () => {
    expect(toWorkspaceRelativePath('/Users/cal/repo-other/file.ts', '/Users/cal/repo')).toBe(
      '/Users/cal/repo-other/file.ts'
    )
  })
})

describe('relativizeWorkspacePathsInText', () => {
  it('rewrites workspace-rooted paths inside free text', () => {
    const result = relativizeWorkspacePathsInText(
      'File not found: /Users/cal/repo/src/index.ts',
      '/Users/cal/repo'
    )
    expect(result).toBe('File not found: src/index.ts')
  })

  it('leaves sibling directories alone', () => {
    const result = relativizeWorkspacePathsInText(
      'Read /Users/cal/repo-other/file.ts',
      '/Users/cal/repo'
    )
    expect(result).toBe('Read /Users/cal/repo-other/file.ts')
  })

  it('is a no-op without a workspaceRoot', () => {
    expect(relativizeWorkspacePathsInText('/Users/cal/repo/a.ts', undefined)).toBe(
      '/Users/cal/repo/a.ts'
    )
  })

  it('replaces the bare root with "."', () => {
    expect(relativizeWorkspacePathsInText('cwd=/Users/cal/repo done', '/Users/cal/repo')).toBe(
      'cwd=. done'
    )
  })

  it('stops at quote and whitespace boundaries', () => {
    expect(
      relativizeWorkspacePathsInText(
        'ran "wc -l /Users/cal/repo/a.ts" and printed path',
        '/Users/cal/repo'
      )
    ).toBe('ran "wc -l a.ts" and printed path')
  })
})
