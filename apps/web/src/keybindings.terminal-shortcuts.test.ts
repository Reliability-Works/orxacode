import { assert, describe, it } from 'vitest'

import {
  isTerminalCloseShortcut,
  isTerminalNewShortcut,
  isTerminalSplitShortcut,
  shortcutLabelForCommand,
} from './keybindings'
import {
  compile,
  DEFAULT_BINDINGS,
  event,
  modShortcut,
  whenAnd,
  whenIdentifier,
  whenNot,
} from './keybindings.test.helpers'

describe('split/new/close terminal shortcuts default focus rules', () => {
  it('requires terminalFocus for default split/new/close bindings', () => {
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: 'd', metaKey: true }), DEFAULT_BINDINGS, {
        platform: 'MacIntel',
        context: { terminalFocus: false },
      })
    )
    assert.isFalse(
      isTerminalNewShortcut(event({ key: 'd', ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: 'Linux',
        context: { terminalFocus: false },
      })
    )
    assert.isFalse(
      isTerminalCloseShortcut(event({ key: 'w', ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: 'Linux',
        context: { terminalFocus: false },
      })
    )
  })

  it('matches split/new when terminalFocus is true', () => {
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: 'd', metaKey: true }), DEFAULT_BINDINGS, {
        platform: 'MacIntel',
        context: { terminalFocus: true },
      })
    )
    assert.isTrue(
      isTerminalNewShortcut(event({ key: 'd', ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: 'Linux',
        context: { terminalFocus: true },
      })
    )
    assert.isTrue(
      isTerminalCloseShortcut(event({ key: 'w', ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: 'Linux',
        context: { terminalFocus: true },
      })
    )
  })
})

describe('split/new/close terminal shortcuts custom when rules', () => {
  it('supports when expressions', () => {
    const keybindings = compile([
      {
        shortcut: modShortcut('\\'),
        command: 'terminal.split',
        whenAst: whenAnd(whenIdentifier('terminalOpen'), whenNot(whenIdentifier('terminalFocus'))),
      },
      {
        shortcut: modShortcut('n', { shiftKey: true }),
        command: 'terminal.new',
        whenAst: whenAnd(whenIdentifier('terminalOpen'), whenNot(whenIdentifier('terminalFocus'))),
      },
      { shortcut: modShortcut('j'), command: 'terminal.toggle' },
    ])
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: '\\', ctrlKey: true }), keybindings, {
        platform: 'Win32',
        context: { terminalOpen: true, terminalFocus: false },
      })
    )
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: '\\', ctrlKey: true }), keybindings, {
        platform: 'Win32',
        context: { terminalOpen: false, terminalFocus: false },
      })
    )
    assert.isTrue(
      isTerminalNewShortcut(event({ key: 'n', ctrlKey: true, shiftKey: true }), keybindings, {
        platform: 'Win32',
        context: { terminalOpen: true, terminalFocus: false },
      })
    )
  })

  it('supports when boolean literals', () => {
    const keybindings = compile([
      { shortcut: modShortcut('n'), command: 'terminal.new', whenAst: whenIdentifier('true') },
      { shortcut: modShortcut('m'), command: 'terminal.new', whenAst: whenIdentifier('false') },
    ])

    assert.isTrue(
      isTerminalNewShortcut(event({ key: 'n', ctrlKey: true }), keybindings, {
        platform: 'Linux',
      })
    )
    assert.isFalse(
      isTerminalNewShortcut(event({ key: 'm', ctrlKey: true }), keybindings, {
        platform: 'Linux',
      })
    )
  })
})

describe('shortcutLabelForCommand direct label resolution', () => {
  it('returns the effective binding label', () => {
    const bindings = compile([
      {
        shortcut: modShortcut('\\'),
        command: 'terminal.split',
        whenAst: whenIdentifier('terminalFocus'),
      },
      {
        shortcut: modShortcut('\\', { shiftKey: true }),
        command: 'terminal.split',
        whenAst: whenNot(whenIdentifier('terminalFocus')),
      },
    ])
    assert.strictEqual(
      shortcutLabelForCommand(bindings, 'terminal.split', {
        platform: 'Linux',
        context: { terminalFocus: true },
      }),
      'Ctrl+\\'
    )
    assert.strictEqual(
      shortcutLabelForCommand(bindings, 'terminal.split', {
        platform: 'Linux',
        context: { terminalFocus: false },
      }),
      'Ctrl+Shift+\\'
    )
  })

  it('returns effective labels for non-terminal commands', () => {
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, 'chat.new', 'MacIntel'), '⇧⌘O')
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, 'diff.toggle', 'Linux'), 'Ctrl+D')
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, 'editor.openFavorite', 'Linux'),
      'Ctrl+O'
    )
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, 'thread.jump.3', 'MacIntel'), '⌘3')
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, 'thread.previous', 'Linux'),
      'Ctrl+Shift+['
    )
  })
})

describe('shortcutLabelForCommand conflicts and context', () => {
  it('returns null for commands shadowed by a later conflicting shortcut', () => {
    const bindings = compile([
      { shortcut: modShortcut('1', { shiftKey: true }), command: 'thread.jump.1' },
      { shortcut: modShortcut('1', { shiftKey: true }), command: 'thread.jump.7' },
    ])

    assert.isNull(shortcutLabelForCommand(bindings, 'thread.jump.1', 'MacIntel'))
    assert.strictEqual(shortcutLabelForCommand(bindings, 'thread.jump.7', 'MacIntel'), '⇧⌘1')
  })

  it('respects when-context while resolving labels', () => {
    const bindings = compile([
      { shortcut: modShortcut('d'), command: 'diff.toggle' },
      {
        shortcut: modShortcut('d'),
        command: 'terminal.split',
        whenAst: whenIdentifier('terminalFocus'),
      },
    ])

    assert.strictEqual(
      shortcutLabelForCommand(bindings, 'diff.toggle', {
        platform: 'Linux',
        context: { terminalFocus: false },
      }),
      'Ctrl+D'
    )
    assert.isNull(
      shortcutLabelForCommand(bindings, 'diff.toggle', {
        platform: 'Linux',
        context: { terminalFocus: true },
      })
    )
    assert.strictEqual(
      shortcutLabelForCommand(bindings, 'terminal.split', {
        platform: 'Linux',
        context: { terminalFocus: true },
      }),
      'Ctrl+D'
    )
  })
})
