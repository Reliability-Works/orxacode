import { describe, expect, it } from 'vitest'

import { classifyCodexCommandAction } from './CodexRuntimeEventMapper.actions.ts'

describe('classifyCodexCommandAction', () => {
  it('classifies a bare grep as search', () => {
    expect(classifyCodexCommandAction('grep -r foo .')).toBe('search')
  })

  it('unwraps /bin/zsh -lc and classifies the inner command', () => {
    expect(classifyCodexCommandAction('/bin/zsh -lc "rg -n \\"Literals\\" apps packages"')).toBe(
      'search'
    )
  })

  it('unwraps bash -c with single quotes', () => {
    expect(classifyCodexCommandAction("bash -c 'ls -la'")).toBe('list')
  })

  it('classifies nl + sed pipeline as read (primary: nl)', () => {
    expect(
      classifyCodexCommandAction(
        '/bin/zsh -lc "nl -ba apps/web/src/session-logic.workHeading.ts | sed -n \'1,240p\'"'
      )
    ).toBe('read')
  })

  it('classifies sed -n alone as read', () => {
    expect(classifyCodexCommandAction('/bin/zsh -lc "sed -n \'1,50p\' file.ts"')).toBe('read')
  })

  it('classifies sed -i as edit', () => {
    expect(classifyCodexCommandAction("/bin/zsh -lc \"sed -i '' 's/a/b/g' file.ts\"")).toBe('edit')
  })

  it('classifies mkdir as create', () => {
    expect(classifyCodexCommandAction('mkdir -p tmp/a/b')).toBe('create')
  })

  it('classifies rm as delete', () => {
    expect(classifyCodexCommandAction('rm -rf tmp')).toBe('delete')
  })

  it('classifies mv/cp as edit', () => {
    expect(classifyCodexCommandAction('mv a.txt b.txt')).toBe('edit')
    expect(classifyCodexCommandAction('cp a.txt b.txt')).toBe('edit')
  })

  it('returns undefined for an unknown command so callers can default to command', () => {
    expect(classifyCodexCommandAction('node build.mjs')).toBeUndefined()
  })

  it('strips leading env var assignments', () => {
    expect(classifyCodexCommandAction('DEBUG=1 grep foo .')).toBe('search')
  })
})
