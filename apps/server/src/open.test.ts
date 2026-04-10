import { chmodSync } from 'node:fs'
import { join } from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, it } from '@effect/vitest'
import { assertSuccess } from '@effect/vitest/utils'
import { FileSystem, Path, Effect } from 'effect'

import {
  isCommandAvailable,
  launchDetached,
  resolveAvailableEditors,
  resolveEditorLaunch,
} from './open'

function markExecutable(filePath: string): void {
  chmodSync(filePath, 0o755)
}

const EMPTY_DARWIN_ENV = {
  PATH: '',
  ORXA_EDITOR_APP_DIRS: '',
} satisfies NodeJS.ProcessEnv

function prepareDarwinBundleEnv() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-home-' })
    const applicationsDir = path.join(homeDir, 'Applications')
    yield* fs.makeDirectory(path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin'), {
      recursive: true,
    })
    yield* fs.makeDirectory(path.join(applicationsDir, 'Zed.app/Contents/MacOS'), {
      recursive: true,
    })
    yield* fs.makeDirectory(path.join(applicationsDir, 'Xcode.app/Contents'), {
      recursive: true,
    })
    yield* fs.makeDirectory(path.join(applicationsDir, 'Terminal.app/Contents'), {
      recursive: true,
    })
    yield* fs.writeFileString(
      path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin/cursor'),
      '#!/bin/sh\n'
    )
    yield* Effect.sync(() =>
      markExecutable(path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin/cursor'))
    )
    yield* fs.writeFileString(
      path.join(applicationsDir, 'Zed.app/Contents/MacOS/cli'),
      '#!/bin/sh\n'
    )
    yield* Effect.sync(() =>
      markExecutable(path.join(applicationsDir, 'Zed.app/Contents/MacOS/cli'))
    )
    return {
      applicationsDir,
      env: {
        HOME: homeDir,
        PATH: '',
        ORXA_EDITOR_APP_DIRS: applicationsDir,
      } satisfies NodeJS.ProcessEnv,
    }
  })
}

it.layer(NodeServices.layer)('resolveEditorLaunch existing coding editors', it => {
  it.effect('returns expected commands', () =>
    Effect.gen(function* () {
      const cursorLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'cursor' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(cursorLaunch, {
        command: 'cursor',
        args: ['/tmp/workspace'],
      })

      const traeLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'trae' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(traeLaunch, {
        command: 'trae',
        args: ['/tmp/workspace'],
      })

      const vscodeLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'vscode' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(vscodeLaunch, {
        command: 'code',
        args: ['/tmp/workspace'],
      })

      const vscodeInsidersLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'vscode-insiders' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(vscodeInsidersLaunch, {
        command: 'code-insiders',
        args: ['/tmp/workspace'],
      })

      const vscodiumLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'vscodium' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(vscodiumLaunch, {
        command: 'codium',
        args: ['/tmp/workspace'],
      })

      const zedLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'zed' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(zedLaunch, {
        command: 'zed',
        args: ['/tmp/workspace'],
      })
    })
  )
})

it.layer(NodeServices.layer)('resolveEditorLaunch requested native apps with CLIs', it => {
  it.effect('returns expected commands', () =>
    Effect.gen(function* () {
      const xcodeLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'xcode' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(xcodeLaunch, {
        command: 'xed',
        args: ['/tmp/workspace'],
      })

      const androidStudioLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'android-studio' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(androidStudioLaunch, {
        command: 'studio',
        args: ['/tmp/workspace'],
      })

      const iTermLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'iterm' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(iTermLaunch, {
        command: 'iterm',
        args: ['/tmp/workspace'],
      })

      const ghosttyLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'ghostty' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(ghosttyLaunch, {
        command: 'ghostty',
        args: ['/tmp/workspace'],
      })
    })
  )
})

it.layer(NodeServices.layer)('resolveEditorLaunch antigravity', it => {
  it.effect('returns the agy command', () =>
    Effect.gen(function* () {
      const antigravityLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'antigravity' },
        'darwin',
        EMPTY_DARWIN_ENV
      )
      assert.deepEqual(antigravityLaunch, {
        command: 'agy',
        args: ['/tmp/workspace'],
      })
    })
  )
})

it.layer(NodeServices.layer)('resolveEditorLaunch macOS bundle fallback', it => {
  it.effect('uses bundle CLI fallbacks for cursor and zed', () =>
    Effect.gen(function* () {
      const { applicationsDir, env } = yield* prepareDarwinBundleEnv()

      const cursorLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'cursor' },
        'darwin',
        env
      )
      assert.deepEqual(cursorLaunch, {
        command: join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin/cursor'),
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const zedLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'zed' },
        'darwin',
        env
      )
      assert.deepEqual(zedLaunch, {
        command: join(applicationsDir, 'Zed.app/Contents/MacOS/cli'),
        args: ['/tmp/workspace'],
      })
    })
  )

  it.effect('uses open -a fallbacks for app bundle editors without CLIs', () =>
    Effect.gen(function* () {
      const { applicationsDir, env } = yield* prepareDarwinBundleEnv()
      const xcodeLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'xcode' },
        'darwin',
        env
      )
      assert.deepEqual(xcodeLaunch, {
        command: 'open',
        args: ['-a', join(applicationsDir, 'Xcode.app'), '/tmp/workspace'],
      })

      const terminalLaunch = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'terminal' },
        'darwin',
        env
      )
      assert.deepEqual(terminalLaunch, {
        command: 'open',
        args: ['-a', join(applicationsDir, 'Terminal.app'), '/tmp/workspace'],
      })
    })
  )
})

it.layer(NodeServices.layer)('resolveEditorLaunch goto support', it => {
  it.effect('uses --goto when editor supports line/column suffixes', () =>
    Effect.gen(function* () {
      const lineOnly = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/AGENTS.md:48', editor: 'cursor' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(lineOnly, {
        command: 'cursor',
        args: ['--goto', '/tmp/workspace/AGENTS.md:48'],
      })

      const lineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'cursor' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(lineAndColumn, {
        command: 'cursor',
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const traeLineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'trae' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(traeLineAndColumn, {
        command: 'trae',
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const vscodeLineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'vscode' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(vscodeLineAndColumn, {
        command: 'code',
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const vscodeInsidersLineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'vscode-insiders' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(vscodeInsidersLineAndColumn, {
        command: 'code-insiders',
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const vscodiumLineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'vscodium' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(vscodiumLineAndColumn, {
        command: 'codium',
        args: ['--goto', '/tmp/workspace/src/open.ts:71:5'],
      })

      const zedLineAndColumn = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace/src/open.ts:71:5', editor: 'zed' },
        'darwin',
        { PATH: '', ORXA_EDITOR_APP_DIRS: '' }
      )
      assert.deepEqual(zedLineAndColumn, {
        command: 'zed',
        args: ['/tmp/workspace/src/open.ts:71:5'],
      })
    })
  )
})

it.layer(NodeServices.layer)('resolveEditorLaunch file manager', it => {
  it.effect('maps file-manager editor to OS open commands', () =>
    Effect.gen(function* () {
      const launch1 = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'file-manager' },
        'darwin'
      )
      assert.deepEqual(launch1, {
        command: 'open',
        args: ['/tmp/workspace'],
      })

      const launch2 = yield* resolveEditorLaunch(
        { cwd: 'C:\\workspace', editor: 'file-manager' },
        'win32'
      )
      assert.deepEqual(launch2, {
        command: 'explorer',
        args: ['C:\\workspace'],
      })

      const launch3 = yield* resolveEditorLaunch(
        { cwd: '/tmp/workspace', editor: 'file-manager' },
        'linux'
      )
      assert.deepEqual(launch3, {
        command: 'xdg-open',
        args: ['/tmp/workspace'],
      })
    })
  )
})

it.layer(NodeServices.layer)('launchDetached', it => {
  it.effect('resolves when command can be spawned', () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
      }).pipe(Effect.result)
      assertSuccess(result, undefined)
    })
  )

  it.effect('rejects when command does not exist', () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: `orxa-no-such-command-${Date.now()}`,
        args: [],
      }).pipe(Effect.result)
      assert.equal(result._tag, 'Failure')
    })
  )
})

it.layer(NodeServices.layer)('isCommandAvailable', it => {
  it.effect('resolves win32 commands with PATHEXT', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-test-' })
      yield* fs.writeFileString(path.join(dir, 'code.CMD'), '@echo off\r\n')
      const env = {
        PATH: dir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      } satisfies NodeJS.ProcessEnv
      assert.equal(isCommandAvailable('code', { platform: 'win32', env }), true)
    })
  )

  it('returns false when a command is not on PATH', () => {
    const env = {
      PATH: '',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    } satisfies NodeJS.ProcessEnv
    assert.equal(isCommandAvailable('definitely-not-installed', { platform: 'win32', env }), false)
  })

  it.effect('does not treat bare files without executable extension as available on win32', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-test-' })
      yield* fs.writeFileString(path.join(dir, 'npm'), 'echo nope\r\n')
      const env = {
        PATH: dir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      } satisfies NodeJS.ProcessEnv
      assert.equal(isCommandAvailable('npm', { platform: 'win32', env }), false)
    })
  )

  it.effect('appends PATHEXT for commands with non-executable extensions on win32', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-test-' })
      yield* fs.writeFileString(path.join(dir, 'my.tool.CMD'), '@echo off\r\n')
      const env = {
        PATH: dir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      } satisfies NodeJS.ProcessEnv
      assert.equal(isCommandAvailable('my.tool', { platform: 'win32', env }), true)
    })
  )

  it.effect('uses platform-specific PATH delimiter for platform overrides', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const firstDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-test-' })
      const secondDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-open-test-' })
      yield* fs.writeFileString(path.join(firstDir, 'code.CMD'), '@echo off\r\n')
      yield* fs.writeFileString(path.join(secondDir, 'code.CMD'), 'MZ')
      const env = {
        PATH: `${firstDir};${secondDir}`,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      } satisfies NodeJS.ProcessEnv
      assert.equal(isCommandAvailable('code', { platform: 'win32', env }), true)
    })
  )
})

it.layer(NodeServices.layer)('resolveAvailableEditors', it => {
  it.effect('returns installed editors for command launches', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-editors-' })

      yield* fs.writeFileString(path.join(dir, 'trae.CMD'), '@echo off\r\n')
      yield* fs.writeFileString(path.join(dir, 'code-insiders.CMD'), '@echo off\r\n')
      yield* fs.writeFileString(path.join(dir, 'codium.CMD'), '@echo off\r\n')
      yield* fs.writeFileString(path.join(dir, 'ghostty.CMD'), '@echo off\r\n')
      yield* fs.writeFileString(path.join(dir, 'explorer.CMD'), 'MZ')
      const editors = resolveAvailableEditors('win32', {
        PATH: dir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      })
      assert.deepEqual(editors, ['trae', 'vscode-insiders', 'vscodium', 'ghostty', 'file-manager'])
    })
  )

  it.effect('detects macOS app bundle editors when PATH shims are absent', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-editors-home-' })
      const applicationsDir = path.join(homeDir, 'Applications')
      yield* fs.makeDirectory(path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin'), {
        recursive: true,
      })
      yield* fs.makeDirectory(path.join(applicationsDir, 'Zed.app/Contents/MacOS'), {
        recursive: true,
      })
      yield* fs.makeDirectory(path.join(applicationsDir, 'Xcode.app/Contents'), {
        recursive: true,
      })
      yield* fs.makeDirectory(path.join(applicationsDir, 'Terminal.app/Contents'), {
        recursive: true,
      })
      yield* fs.makeDirectory(path.join(applicationsDir, 'Ghostty.app/Contents'), {
        recursive: true,
      })
      yield* fs.writeFileString(
        path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin/cursor'),
        '#!/bin/sh\n'
      )
      yield* Effect.sync(() =>
        markExecutable(path.join(applicationsDir, 'Cursor.app/Contents/Resources/app/bin/cursor'))
      )
      yield* fs.writeFileString(
        path.join(applicationsDir, 'Zed.app/Contents/MacOS/cli'),
        '#!/bin/sh\n'
      )
      yield* Effect.sync(() =>
        markExecutable(path.join(applicationsDir, 'Zed.app/Contents/MacOS/cli'))
      )

      const editors = resolveAvailableEditors('darwin', {
        HOME: homeDir,
        PATH: '',
        ORXA_EDITOR_APP_DIRS: applicationsDir,
      })
      assert.deepEqual(editors, ['cursor', 'zed', 'xcode', 'terminal', 'ghostty'])
    })
  )
})
