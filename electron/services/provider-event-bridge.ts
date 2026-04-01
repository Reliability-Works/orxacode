import type { OrxaEvent } from '../../shared/ipc'
import type { ClaudeChatService } from './claude-chat-service'
import type { CodexService } from './codex-service'

type ProviderEventBridgeDeps = {
  codexService: CodexService
  claudeChatService: ClaudeChatService
  publishEvent: (event: OrxaEvent) => void
}

export function registerProviderEventBridge({
  codexService,
  claudeChatService,
  publishEvent,
}: ProviderEventBridgeDeps) {
  codexService.on('state', (payload: unknown) => {
    publishEvent({ type: 'codex.state', payload } as OrxaEvent)
  })

  codexService.on('notification', (payload: unknown) => {
    publishEvent({ type: 'codex.notification', payload } as OrxaEvent)
  })

  codexService.on('approval', (payload: unknown) => {
    publishEvent({ type: 'codex.approval', payload } as OrxaEvent)
  })

  codexService.on('userInput', (payload: unknown) => {
    publishEvent({ type: 'codex.userInput', payload } as OrxaEvent)
  })

  claudeChatService.on('state', (payload: unknown) => {
    publishEvent({ type: 'claude-chat.state', payload } as OrxaEvent)
  })

  claudeChatService.on('notification', (payload: unknown) => {
    publishEvent({ type: 'claude-chat.notification', payload } as OrxaEvent)
  })

  claudeChatService.on('approval', (payload: unknown) => {
    publishEvent({ type: 'claude-chat.approval', payload } as OrxaEvent)
  })

  claudeChatService.on('userInput', (payload: unknown) => {
    publishEvent({ type: 'claude-chat.userInput', payload } as OrxaEvent)
  })
}
