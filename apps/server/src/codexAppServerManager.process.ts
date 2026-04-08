import {
  classifyCodexStderrLine,
  isResponseMessage,
  isServerNotificationMessage,
  isServerRequestMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './codexAppServerManager.protocol'
import { type CodexSessionContextLike } from './codexAppServerManager.events'

export interface ProcessRuntimeCallbacks {
  readonly emitErrorEvent: (method: string, message: string) => void
  readonly emitNotificationEvent: (method: string, message: string) => void
  readonly emitLifecycleEvent: (method: string, message: string) => void
  readonly updateSession: (updates: Partial<CodexSessionContextLike['session']>) => void
  readonly removeSession: () => void
  readonly handleServerRequest: (request: JsonRpcRequest) => void
  readonly handleServerNotification: (notification: JsonRpcNotification) => void
  readonly handleResponse: (response: JsonRpcResponse) => void
}

export function attachProcessListeners(
  context: CodexSessionContextLike,
  callbacks: ProcessRuntimeCallbacks
): void {
  context.output.on('line', line => {
    handleStdoutLine(line, callbacks)
  })

  context.child.stderr.on('data', (chunk: Buffer) => {
    const raw = chunk.toString()
    const lines = raw.split(/\r?\n/g)
    for (const rawLine of lines) {
      const classified = classifyCodexStderrLine(rawLine)
      if (!classified) {
        continue
      }

      callbacks.emitNotificationEvent('process/stderr', classified.message)
    }
  })

  context.child.on('error', error => {
    const message = error.message || 'codex app-server process errored.'
    callbacks.updateSession({
      status: 'error',
      lastError: message,
    })
    callbacks.emitErrorEvent('process/error', message)
  })

  context.child.on('exit', (code, signal) => {
    if (context.stopping) {
      return
    }

    const message = `codex app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
    callbacks.updateSession({
      status: 'closed',
      activeTurnId: undefined,
      lastError: code === 0 ? context.session.lastError : message,
    })
    callbacks.emitLifecycleEvent('session/exited', message)
    callbacks.removeSession()
  })
}

export function handleStdoutLine(line: string, callbacks: ProcessRuntimeCallbacks): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    callbacks.emitErrorEvent('protocol/parseError', 'Received invalid JSON from codex app-server.')
    return
  }

  if (!parsed || typeof parsed !== 'object') {
    callbacks.emitErrorEvent('protocol/invalidMessage', 'Received non-object protocol message.')
    return
  }

  if (isServerRequestMessage(parsed)) {
    callbacks.handleServerRequest(parsed)
    return
  }

  if (isServerNotificationMessage(parsed)) {
    callbacks.handleServerNotification(parsed)
    return
  }

  if (isResponseMessage(parsed)) {
    callbacks.handleResponse(parsed)
    return
  }

  callbacks.emitErrorEvent(
    'protocol/unrecognizedMessage',
    'Received protocol message in an unknown shape.'
  )
}
