/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import {
  buildInteractionScript,
  buildPressScript,
  buildRecoveryScript,
  buildScrollScript,
} from './browser-dom-scripts'

describe('browser-dom-scripts', () => {
  it('builds recovery script variants', () => {
    const dismiss = buildRecoveryScript('dismiss_overlays')
    const stabilize = buildRecoveryScript('stabilize')

    expect(dismiss).toContain('const step = "dismiss_overlays";')
    expect(dismiss).toContain('selectors = [')
    expect(stabilize).toContain('const step = "stabilize";')
    expect(stabilize).toContain('window.dispatchEvent(new Event("resize"))')
  })

  it('builds interaction script with locator and options payload', () => {
    const script = buildInteractionScript(
      'type',
      {
        selector: '#email',
        label: 'Email',
        includeShadowDom: true,
      },
      {
        text: 'test@example.com',
        clear: true,
        timeoutMs: 12000,
      }
    )

    expect(script).toContain('const mode = "type";')
    expect(script).toContain('"selector":"#email"')
    expect(script).toContain('"text":"test@example.com"')
    expect(script).toContain('queryByLabel')
    expect(script).toContain('selector_not_found')
  })

  it('builds key press script with enter submit guard', () => {
    const script = buildPressScript('Enter')
    expect(script).toContain('new KeyboardEvent("keydown"')
    expect(script).toContain('target.form.requestSubmit()')
  })

  it('builds absolute and relative scroll scripts', () => {
    const absolute = buildScrollScript(undefined, undefined, 120, 30, 'smooth')
    const relative = buildScrollScript(15, 20, undefined, undefined, 'auto')

    expect(absolute).toContain('window.scrollTo({')
    expect(absolute).toContain('"smooth"')
    expect(relative).toContain('window.scrollBy({')
    expect(relative).toContain('"auto"')
  })
})
