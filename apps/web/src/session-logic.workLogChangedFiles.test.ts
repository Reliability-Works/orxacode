import { describe, expect, it } from 'vitest'

import { extractChangedFilesFromCommand } from './session-logic.workLogChangedFiles'

describe('extractChangedFilesFromCommand', () => {
  it('extracts file args from rm', () => {
    expect(extractChangedFilesFromCommand('rm a.txt b.txt')).toEqual(['a.txt', 'b.txt'])
  })

  it('skips flags', () => {
    expect(extractChangedFilesFromCommand('rm -rf tmp/dir')).toEqual(['tmp/dir'])
  })

  it('handles mkdir and touch', () => {
    expect(extractChangedFilesFromCommand('mkdir -p foo/bar')).toEqual(['foo/bar'])
    expect(extractChangedFilesFromCommand('touch a.txt b.txt')).toEqual(['a.txt', 'b.txt'])
  })

  it('splits on && and dedupes across segments', () => {
    expect(extractChangedFilesFromCommand('rm a.txt && rm b.txt && rm a.txt')).toEqual([
      'a.txt',
      'b.txt',
    ])
  })

  it('unquotes simple single and double quoted args without spaces', () => {
    expect(extractChangedFilesFromCommand('rm \'a.txt\' "b.txt"')).toEqual(['a.txt', 'b.txt'])
  })

  it('returns [] for unrelated commands', () => {
    expect(extractChangedFilesFromCommand('ls -la')).toEqual([])
  })
})
