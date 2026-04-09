/**
 * Open - Browser/editor launch service interface.
 *
 * Owns process launch helpers for opening URLs in a browser and workspace
 * paths in a configured editor.
 *
 * @module Open
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { extname, join } from 'node:path'

import { EDITORS, OpenError, type EditorDefinition, type EditorId } from '@orxa-code/contracts'
import { ServiceMap, Effect, Layer } from 'effect'

// ==============================
// Definitions
// ==============================

export { OpenError }

export interface OpenInEditorInput {
  readonly cwd: string
  readonly editor: EditorId
}

interface EditorLaunch {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

interface CommandAvailabilityOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
}

const LINE_COLUMN_SUFFIX_PATTERN = /:\d+(?::\d+)?$/

function shouldUseGotoFlag(editor: (typeof EDITORS)[number], target: string): boolean {
  return editor.supportsGoto && LINE_COLUMN_SUFFIX_PATTERN.test(target)
}

function resolveDarwinApplicationRoots(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const configured = env.ORXA_EDITOR_APP_DIRS
  if (configured !== undefined) {
    return configured
      .split(resolvePathDelimiter('darwin'))
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0)
  }

  const homeDir = env.HOME?.trim()
  const homeApplicationsDir = homeDir ? join(homeDir, 'Applications') : null
  return ['/Applications', ...(homeApplicationsDir ? [homeApplicationsDir] : [])]
}

function resolveDarwinEditorCommandCandidates(
  editor: EditorDefinition,
  env: NodeJS.ProcessEnv
): ReadonlyArray<string> {
  const applicationRoots = resolveDarwinApplicationRoots(env)
  if (editor.id === 'cursor') {
    return [
      'cursor',
      ...applicationRoots.map(root => join(root, 'Cursor.app/Contents/Resources/app/bin/cursor')),
      ...applicationRoots.map(root => join(root, 'Cursor.app/Contents/MacOS/Cursor')),
    ]
  }
  if (editor.id === 'zed') {
    return [
      'zed',
      ...applicationRoots.map(root => join(root, 'Zed.app/Contents/MacOS/cli')),
      ...applicationRoots.map(root => join(root, 'Zed.app/Contents/MacOS/zed')),
    ]
  }
  if (editor.id === 'antigravity') {
    return [
      'agy',
      'antigravity',
      ...applicationRoots.map(root => join(root, 'Antigravity.app/Contents/MacOS/antigravity')),
      ...applicationRoots.map(root => join(root, 'Antigravity.app/Contents/MacOS/Antigravity')),
    ]
  }
  return editor.command ? [editor.command] : []
}

function resolveEditorCommandCandidates(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): ReadonlyArray<string> {
  if (editor.id === 'file-manager') {
    return [fileManagerCommandForPlatform(platform)]
  }
  if (platform === 'darwin') {
    return resolveDarwinEditorCommandCandidates(editor, env)
  }
  return editor.command ? [editor.command] : []
}

function findAvailableEditorCommand(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string | null {
  const candidates = resolveEditorCommandCandidates(editor, platform, env)
  for (const candidate of candidates) {
    if (isCommandAvailable(candidate, { platform, env })) return candidate
  }
  return null
}

function resolveLaunchEditorCommand(
  editor: EditorDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string | null {
  return (
    findAvailableEditorCommand(editor, platform, env) ??
    resolveEditorCommandCandidates(editor, platform, env)[0] ??
    null
  )
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'open'
    case 'win32':
      return 'explorer'
    default:
      return 'xdg-open'
  }
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, '')
}

function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? ''
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT
  const fallback = ['.COM', '.EXE', '.BAT', '.CMD']
  if (!rawValue) return fallback

  const parsed = rawValue
    .split(';')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => (entry.startsWith('.') ? entry.toUpperCase() : `.${entry.toUpperCase()}`))
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback
}

function resolveCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>
): ReadonlyArray<string> {
  if (platform !== 'win32') return [command]
  const extension = extname(command)
  const normalizedExtension = extension.toUpperCase()

  if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
    const commandWithoutExtension = command.slice(0, -extension.length)
    return Array.from(
      new Set([
        command,
        `${commandWithoutExtension}${normalizedExtension}`,
        `${commandWithoutExtension}${normalizedExtension.toLowerCase()}`,
      ])
    )
  }

  const candidates: string[] = []
  for (const extension of windowsPathExtensions) {
    candidates.push(`${command}${extension}`)
    candidates.push(`${command}${extension.toLowerCase()}`)
  }
  return Array.from(new Set(candidates))
}

function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>
): boolean {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false
    if (platform === 'win32') {
      const extension = extname(filePath)
      if (extension.length === 0) return false
      return windowsPathExtensions.includes(extension.toUpperCase())
    }
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolvePathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

export function isCommandAvailable(
  command: string,
  options: CommandAvailabilityOptions = {}
): boolean {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const windowsPathExtensions = platform === 'win32' ? resolveWindowsPathExtensions(env) : []
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions)

  if (command.includes('/') || command.includes('\\')) {
    return commandCandidates.some(candidate =>
      isExecutableFile(candidate, platform, windowsPathExtensions)
    )
  }

  const pathValue = resolvePathEnvironmentVariable(env)
  if (pathValue.length === 0) return false
  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map(entry => stripWrappingQuotes(entry.trim()))
    .filter(entry => entry.length > 0)

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (isExecutableFile(join(pathEntry, candidate), platform, windowsPathExtensions)) {
        return true
      }
    }
  }
  return false
}

export function resolveAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ReadonlyArray<EditorId> {
  const available: EditorId[] = []

  for (const editor of EDITORS) {
    if (findAvailableEditorCommand(editor, platform, env)) {
      available.push(editor.id)
    }
  }

  return available
}

/**
 * OpenShape - Service API for browser and editor launch actions.
 */
export interface OpenShape {
  /**
   * Open a URL target in the default browser.
   */
  readonly openBrowser: (target: string) => Effect.Effect<void, OpenError>

  /**
   * Open a workspace path in a selected editor integration.
   *
   * Launches the editor as a detached process so server startup is not blocked.
   */
  readonly openInEditor: (input: OpenInEditorInput) => Effect.Effect<void, OpenError>
}

/**
 * Open - Service tag for browser/editor launch operations.
 */
export class Open extends ServiceMap.Service<Open, OpenShape>()('orxacode/open') {}

// ==============================
// Implementations
// ==============================

export const resolveEditorLaunch = Effect.fnUntraced(function* (
  input: OpenInEditorInput,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Effect.fn.Return<EditorLaunch, OpenError> {
  const editorDef = EDITORS.find(editor => editor.id === input.editor)
  if (!editorDef) {
    return yield* new OpenError({ message: `Unknown editor: ${input.editor}` })
  }

  const command = resolveLaunchEditorCommand(editorDef, platform, env)
  if (command && editorDef.id !== 'file-manager') {
    return shouldUseGotoFlag(editorDef, input.cwd)
      ? { command, args: ['--goto', input.cwd] }
      : { command, args: [input.cwd] }
  }

  if (editorDef.id !== 'file-manager') {
    return yield* new OpenError({ message: `Unsupported editor: ${input.editor}` })
  }

  return {
    command:
      resolveLaunchEditorCommand(editorDef, platform, env) ??
      fileManagerCommandForPlatform(platform),
    args: [input.cwd],
  }
})

export const resolveBrowserLaunch = (
  target: string,
  platform: NodeJS.Platform = process.platform
): EditorLaunch => ({
  command: fileManagerCommandForPlatform(platform),
  args: [target],
})

export const launchDetached = (launch: EditorLaunch) =>
  Effect.gen(function* () {
    if (!isCommandAvailable(launch.command)) {
      return yield* new OpenError({ message: `Launch command not found: ${launch.command}` })
    }

    yield* Effect.callback<void, OpenError>(resume => {
      let child
      try {
        child = spawn(launch.command, [...launch.args], {
          detached: true,
          stdio: 'ignore',
          shell: process.platform === 'win32',
        })
      } catch (error) {
        return resume(
          Effect.fail(new OpenError({ message: 'failed to spawn detached process', cause: error }))
        )
      }

      const handleSpawn = () => {
        child.unref()
        resume(Effect.void)
      }

      child.once('spawn', handleSpawn)
      child.once('error', cause =>
        resume(Effect.fail(new OpenError({ message: 'failed to spawn detached process', cause })))
      )
    })
  })

const make = Effect.succeed({
  openBrowser: target => launchDetached(resolveBrowserLaunch(target)),
  openInEditor: input => Effect.flatMap(resolveEditorLaunch(input), launchDetached),
} satisfies OpenShape)

export const OpenLive = Layer.effect(Open, make)
