import { FitAddon } from '@xterm/addon-fit'
import { type ThreadId } from '@orxa-code/contracts'
import { Terminal } from '@xterm/xterm'
import { type MutableRefObject } from 'react'
import { type TerminalContextSelection } from '~/lib/terminalContext'
import {
  resolveTerminalSelectionActionPosition,
  shouldHandleTerminalSelectionMouseUp,
  terminalSelectionActionDelayForClickCount,
} from './ThreadTerminalDrawer.logic'
import { terminalThemeFromApp } from './ThreadTerminalDrawer.theme'
import { openInPreferredEditor } from '../editorPreferences'
import {
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
} from '../terminal-links'
import { isTerminalClearShortcut, terminalNavigationShortcutData } from '../keybindings'
import { readNativeApi } from '~/nativeApi'

export interface TerminalViewportSetupRefs {
  containerRef: MutableRefObject<HTMLDivElement | null>
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  onSessionExitedRef: MutableRefObject<() => void>
  onAddTerminalContextRef: MutableRefObject<(selection: TerminalContextSelection) => void>
  terminalLabelRef: MutableRefObject<string>
  hasHandledExitRef: MutableRefObject<boolean>
  selectionPointerRef: MutableRefObject<{ x: number; y: number } | null>
  selectionGestureActiveRef: MutableRefObject<boolean>
  selectionActionRequestIdRef: MutableRefObject<number>
  selectionActionOpenRef: MutableRefObject<boolean>
  selectionActionTimerRef: MutableRefObject<number | null>
}

export interface TerminalViewportSetupProps {
  threadId: ThreadId
  terminalId: string
  cwd: string
  runtimeEnv: Record<string, string> | undefined
  autoFocus: boolean
}

export function writeTerminalSystemMessage(terminal: Terminal, message: string): void {
  terminal.write(`\r\n[terminal] ${message}\r\n`)
}

function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const commonAncestor = range.commonAncestorContainer
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) return null
  const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0)
  if (rects.length > 0) return rects[rects.length - 1] ?? null
  const boundingRect = range.getBoundingClientRect()
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null
}

interface SelectionActionContext {
  refs: TerminalViewportSetupRefs
  terminalId: string
  api: NonNullable<ReturnType<typeof readNativeApi>>
  clearSelectionAction: () => void
}

function buildSelectionActionHelpers(ctx: SelectionActionContext) {
  const { refs, terminalId, api, clearSelectionAction } = ctx

  const readSelectionAction = () => {
    const activeTerminal = refs.terminalRef.current
    const mountElement = refs.containerRef.current
    if (!activeTerminal || !mountElement || !activeTerminal.hasSelection()) return null
    const selectionText = activeTerminal.getSelection()
    const selectionPosition = activeTerminal.getSelectionPosition()
    const normalizedText = selectionText.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
    if (!selectionPosition || normalizedText.length === 0) return null
    const lineStart = selectionPosition.start.y + 1
    const lineCount = normalizedText.split('\n').length
    const lineEnd = Math.max(lineStart, lineStart + lineCount - 1)
    const bounds = mountElement.getBoundingClientRect()
    const selectionRect = getTerminalSelectionRect(mountElement)
    const position = resolveTerminalSelectionActionPosition({
      bounds,
      selectionRect:
        selectionRect === null
          ? null
          : { right: selectionRect.right, bottom: selectionRect.bottom },
      pointer: refs.selectionPointerRef.current,
    })
    return {
      position,
      selection: {
        terminalId,
        terminalLabel: refs.terminalLabelRef.current,
        lineStart,
        lineEnd,
        text: normalizedText,
      },
    }
  }

  const showSelectionAction = async () => {
    if (refs.selectionActionOpenRef.current) return
    const nextAction = readSelectionAction()
    if (!nextAction) {
      clearSelectionAction()
      return
    }
    const requestId = ++refs.selectionActionRequestIdRef.current
    refs.selectionActionOpenRef.current = true
    try {
      const clicked = await api.contextMenu.show(
        [{ id: 'add-to-chat', label: 'Add to chat' }],
        nextAction.position
      )
      if (requestId !== refs.selectionActionRequestIdRef.current || clicked !== 'add-to-chat')
        return
      refs.onAddTerminalContextRef.current(nextAction.selection)
      refs.terminalRef.current?.clearSelection()
      refs.terminalRef.current?.focus()
    } finally {
      refs.selectionActionOpenRef.current = false
    }
  }

  return { showSelectionAction }
}

function attachTerminalKeyHandler(
  terminal: Terminal,
  api: NonNullable<ReturnType<typeof readNativeApi>>,
  threadId: ThreadId,
  terminalId: string,
  terminalRef: MutableRefObject<Terminal | null>
) {
  const sendInput = async (data: string, fallbackError: string) => {
    const active = terminalRef.current
    if (!active) return
    try {
      await api.terminal.write({ threadId, terminalId, data })
    } catch (error) {
      writeTerminalSystemMessage(active, error instanceof Error ? error.message : fallbackError)
    }
  }
  terminal.attachCustomKeyEventHandler(event => {
    const navigationData = terminalNavigationShortcutData(event)
    if (navigationData !== null) {
      event.preventDefault()
      event.stopPropagation()
      void sendInput(navigationData, 'Failed to move cursor')
      return false
    }
    if (!isTerminalClearShortcut(event)) return true
    event.preventDefault()
    event.stopPropagation()
    void sendInput('\u000c', 'Failed to clear terminal')
    return false
  })
}

function registerTerminalLinks(
  terminal: Terminal,
  api: NonNullable<ReturnType<typeof readNativeApi>>,
  cwd: string,
  terminalRef: MutableRefObject<Terminal | null>
) {
  return terminal.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      const active = terminalRef.current
      if (!active) {
        callback(undefined)
        return
      }
      const line = active.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }
      const lineText = line.translateToString(true)
      const matches = extractTerminalLinks(lineText)
      if (matches.length === 0) {
        callback(undefined)
        return
      }
      callback(
        matches.map(match => ({
          text: match.text,
          range: {
            start: { x: match.start + 1, y: bufferLineNumber },
            end: { x: match.end, y: bufferLineNumber },
          },
          activate: (event: MouseEvent) => {
            if (!isTerminalLinkActivation(event)) return
            const latest = terminalRef.current
            if (!latest) return
            if (match.kind === 'url') {
              void api.shell.openExternal(match.text).catch(error => {
                writeTerminalSystemMessage(
                  latest,
                  error instanceof Error ? error.message : 'Unable to open link'
                )
              })
              return
            }
            const target = resolvePathLinkTarget(match.text, cwd)
            void openInPreferredEditor(api, target).catch(error => {
              writeTerminalSystemMessage(
                latest,
                error instanceof Error ? error.message : 'Unable to open path'
              )
            })
          },
        }))
      )
    },
  })
}

function subscribeTerminalEvents(
  terminal: Terminal,
  api: NonNullable<ReturnType<typeof readNativeApi>>,
  props: TerminalViewportSetupProps,
  refs: TerminalViewportSetupRefs,
  clearSelectionAction: () => void
) {
  return api.terminal.onEvent(event => {
    if (event.threadId !== props.threadId || event.terminalId !== props.terminalId) return
    const active = refs.terminalRef.current
    if (!active) return
    if (event.type === 'output') {
      active.write(event.data)
      clearSelectionAction()
      return
    }
    if (event.type === 'started' || event.type === 'restarted') {
      refs.hasHandledExitRef.current = false
      clearSelectionAction()
      active.write('\u001bc')
      if (event.snapshot.history.length > 0) active.write(event.snapshot.history)
      return
    }
    if (event.type === 'cleared') {
      clearSelectionAction()
      active.clear()
      active.write('\u001bc')
      return
    }
    if (event.type === 'error') {
      writeTerminalSystemMessage(active, event.message)
      return
    }
    if (event.type === 'exited') {
      const details = [
        typeof event.exitCode === 'number' ? `code ${event.exitCode}` : null,
        typeof event.exitSignal === 'number' ? `signal ${event.exitSignal}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(', ')
      writeTerminalSystemMessage(
        active,
        details.length > 0 ? `Process exited (${details})` : 'Process exited'
      )
      if (refs.hasHandledExitRef.current) return
      refs.hasHandledExitRef.current = true
      window.setTimeout(() => {
        if (!refs.hasHandledExitRef.current) return
        refs.onSessionExitedRef.current()
      }, 0)
    }
  })
}

interface SelectionMouseContext {
  refs: TerminalViewportSetupRefs
  showSelectionAction: () => Promise<void>
  clearSelectionAction: () => void
}

function buildMouseHandlers(ctx: SelectionMouseContext, mount: HTMLElement) {
  const { refs, showSelectionAction, clearSelectionAction } = ctx
  const handleMouseUp = (event: MouseEvent) => {
    const shouldHandle = shouldHandleTerminalSelectionMouseUp(
      refs.selectionGestureActiveRef.current,
      event.button
    )
    refs.selectionGestureActiveRef.current = false
    if (!shouldHandle) return
    refs.selectionPointerRef.current = { x: event.clientX, y: event.clientY }
    const delay = terminalSelectionActionDelayForClickCount(event.detail)
    refs.selectionActionTimerRef.current = window.setTimeout(() => {
      refs.selectionActionTimerRef.current = null
      window.requestAnimationFrame(() => {
        void showSelectionAction()
      })
    }, delay)
  }
  const handlePointerDown = (event: PointerEvent) => {
    clearSelectionAction()
    refs.selectionGestureActiveRef.current = event.button === 0
  }
  window.addEventListener('mouseup', handleMouseUp)
  mount.addEventListener('pointerdown', handlePointerDown)
  return { handleMouseUp, handlePointerDown }
}

function startTerminalSession(
  terminal: Terminal,
  api: NonNullable<ReturnType<typeof readNativeApi>>,
  refs: TerminalViewportSetupRefs,
  props: TerminalViewportSetupProps,
  disposedGetter: () => boolean
) {
  const openTerminal = async () => {
    try {
      const active = refs.terminalRef.current
      const activeFit = refs.fitAddonRef.current
      if (!active || !activeFit) return
      activeFit.fit()
      const snapshot = await api.terminal.open({
        threadId: props.threadId,
        terminalId: props.terminalId,
        cwd: props.cwd,
        cols: active.cols,
        rows: active.rows,
        ...(props.runtimeEnv ? { env: props.runtimeEnv } : {}),
      })
      if (disposedGetter()) return
      active.write('\u001bc')
      if (snapshot.history.length > 0) active.write(snapshot.history)
      if (props.autoFocus)
        window.requestAnimationFrame(() => {
          active.focus()
        })
    } catch (err) {
      if (disposedGetter()) return
      writeTerminalSystemMessage(
        terminal,
        err instanceof Error ? err.message : 'Failed to open terminal'
      )
    }
  }
  const fitTimer = window.setTimeout(() => {
    const active = refs.terminalRef.current
    const activeFit = refs.fitAddonRef.current
    if (!active || !activeFit) return
    const wasAtBottom = active.buffer.active.viewportY >= active.buffer.active.baseY
    activeFit.fit()
    if (wasAtBottom) active.scrollToBottom()
    void api.terminal
      .resize({
        threadId: props.threadId,
        terminalId: props.terminalId,
        cols: active.cols,
        rows: active.rows,
      })
      .catch(() => undefined)
  }, 30)
  void openTerminal()
  return fitTimer
}

function constructTerminal(
  refs: TerminalViewportSetupRefs,
  mount: HTMLDivElement
): { terminal: Terminal; fitAddon: FitAddon } {
  const fitAddon = new FitAddon()
  const terminal = new Terminal({
    cursorBlink: true,
    lineHeight: 1.2,
    fontSize: 12,
    scrollback: 5_000,
    fontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    theme: terminalThemeFromApp(),
  })
  terminal.loadAddon(fitAddon)
  terminal.open(mount)
  fitAddon.fit()
  refs.terminalRef.current = terminal
  refs.fitAddonRef.current = fitAddon
  return { terminal, fitAddon }
}

function createClearSelectionAction(refs: TerminalViewportSetupRefs) {
  return () => {
    refs.selectionActionRequestIdRef.current += 1
    if (refs.selectionActionTimerRef.current !== null) {
      window.clearTimeout(refs.selectionActionTimerRef.current)
      refs.selectionActionTimerRef.current = null
    }
  }
}

function observeTerminalTheme(refs: TerminalViewportSetupRefs): MutationObserver {
  const themeObserver = new MutationObserver(() => {
    const active = refs.terminalRef.current
    if (!active) return
    active.options.theme = terminalThemeFromApp()
    active.refresh(0, active.rows - 1)
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  return themeObserver
}

interface TerminalWiring {
  inputDisposable: { dispose: () => void }
  selectionDisposable: { dispose: () => void }
  terminalLinksDisposable: { dispose: () => void }
  handleMouseUp: (event: MouseEvent) => void
  handlePointerDown: (event: PointerEvent) => void
}

function wireTerminalEvents(
  terminal: Terminal,
  api: NonNullable<ReturnType<typeof readNativeApi>>,
  refs: TerminalViewportSetupRefs,
  props: TerminalViewportSetupProps,
  mount: HTMLDivElement,
  clearSelectionAction: () => void
): TerminalWiring {
  const { showSelectionAction } = buildSelectionActionHelpers({
    refs,
    terminalId: props.terminalId,
    api,
    clearSelectionAction,
  })
  attachTerminalKeyHandler(terminal, api, props.threadId, props.terminalId, refs.terminalRef)
  const terminalLinksDisposable = registerTerminalLinks(terminal, api, props.cwd, refs.terminalRef)
  const inputDisposable = terminal.onData(data => {
    void api.terminal
      .write({ threadId: props.threadId, terminalId: props.terminalId, data })
      .catch(err =>
        writeTerminalSystemMessage(
          terminal,
          err instanceof Error ? err.message : 'Terminal write failed'
        )
      )
  })
  const selectionDisposable = terminal.onSelectionChange(() => {
    if (refs.terminalRef.current?.hasSelection()) return
    clearSelectionAction()
  })
  const { handleMouseUp, handlePointerDown } = buildMouseHandlers(
    { refs, showSelectionAction, clearSelectionAction },
    mount
  )
  return {
    inputDisposable,
    selectionDisposable,
    terminalLinksDisposable,
    handleMouseUp,
    handlePointerDown,
  }
}

interface TerminalCleanupInput {
  refs: TerminalViewportSetupRefs
  terminal: Terminal
  mount: HTMLDivElement
  wiring: TerminalWiring
  themeObserver: MutationObserver
  unsubscribe: () => void
  fitTimer: number
  setDisposed: () => void
}

function buildTerminalCleanup(input: TerminalCleanupInput): () => void {
  return () => {
    input.setDisposed()
    window.clearTimeout(input.fitTimer)
    input.unsubscribe()
    input.wiring.inputDisposable.dispose()
    input.wiring.selectionDisposable.dispose()
    input.wiring.terminalLinksDisposable.dispose()
    if (input.refs.selectionActionTimerRef.current !== null)
      window.clearTimeout(input.refs.selectionActionTimerRef.current)
    window.removeEventListener('mouseup', input.wiring.handleMouseUp)
    input.mount.removeEventListener('pointerdown', input.wiring.handlePointerDown)
    input.themeObserver.disconnect()
    input.refs.terminalRef.current = null
    input.refs.fitAddonRef.current = null
    input.terminal.dispose()
  }
}

export function setupTerminalViewport(
  refs: TerminalViewportSetupRefs,
  props: TerminalViewportSetupProps
): (() => void) | undefined {
  const mount = refs.containerRef.current
  if (!mount) return undefined
  const { terminal } = constructTerminal(refs, mount)
  const api = readNativeApi()
  if (!api) return undefined
  let disposed = false
  const clearSelectionAction = createClearSelectionAction(refs)
  const wiring = wireTerminalEvents(terminal, api, refs, props, mount, clearSelectionAction)
  const themeObserver = observeTerminalTheme(refs)
  const unsubscribe = subscribeTerminalEvents(terminal, api, props, refs, clearSelectionAction)
  const fitTimer = startTerminalSession(terminal, api, refs, props, () => disposed)
  return buildTerminalCleanup({
    refs,
    terminal,
    mount,
    wiring,
    themeObserver,
    unsubscribe,
    fitTimer,
    setDisposed: () => {
      disposed = true
    },
  })
}
