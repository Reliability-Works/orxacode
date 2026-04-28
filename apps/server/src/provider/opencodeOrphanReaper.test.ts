import { describe, expect, it } from 'vitest'

import { looksLikeOpencodeServe, parsePsLine } from './opencodeOrphanReaper'

describe('parsePsLine', () => {
  it('parses a real ps line into pid/ppid/command', () => {
    const parsed = parsePsLine(
      '  3090     1 /Users/callumspencer/.local/share/mise/installs/node/22.22.2/lib/node_modules/opencode-ai/bin/.opencode serve --port 57698'
    )
    expect(parsed).toEqual({
      pid: 3090,
      ppid: 1,
      command:
        '/Users/callumspencer/.local/share/mise/installs/node/22.22.2/lib/node_modules/opencode-ai/bin/.opencode serve --port 57698',
    })
  })

  it('returns null for blank or malformed lines', () => {
    expect(parsePsLine('')).toBeNull()
    expect(parsePsLine('   ')).toBeNull()
    expect(parsePsLine('not a ps line')).toBeNull()
    expect(parsePsLine('123 abc /bin/something')).toBeNull()
  })
})

describe('looksLikeOpencodeServe', () => {
  it('matches the canonical npm-shim invocation seen in production', () => {
    expect(
      looksLikeOpencodeServe(
        '/Users/callumspencer/.local/share/mise/installs/node/22.22.2/lib/node_modules/opencode-ai/bin/.opencode serve --port 57698'
      )
    ).toBe(true)
  })

  it('matches a bare `opencode serve` invocation', () => {
    expect(looksLikeOpencodeServe('opencode serve --port 12345')).toBe(true)
  })

  it('matches when binary is at the start of the line', () => {
    expect(looksLikeOpencodeServe('/usr/local/bin/opencode serve --port 8080')).toBe(true)
  })

  it('does not match opencode subcommands other than serve', () => {
    expect(looksLikeOpencodeServe('opencode tui --port 8080')).toBe(false)
    expect(looksLikeOpencodeServe('opencode auth login')).toBe(false)
  })

  it('does not match unrelated binaries that happen to mention serve', () => {
    expect(looksLikeOpencodeServe('node server.js serve --port 8080')).toBe(false)
    expect(looksLikeOpencodeServe('npm run serve --port 8080')).toBe(false)
    expect(looksLikeOpencodeServe('myopencode-clone serve --port 8080')).toBe(false)
  })

  it('requires both serve and --port to be present', () => {
    expect(looksLikeOpencodeServe('opencode serve')).toBe(false)
    expect(looksLikeOpencodeServe('opencode --port 8080')).toBe(false)
  })
})
