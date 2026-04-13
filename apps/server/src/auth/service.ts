import { Effect, Layer } from 'effect'

import { ServerConfig } from '../config'
import { makeServerAuthShape } from './service.runtime'
import { ServerAuth } from './service.types'

export * from './service.types'

export const ServerAuthLive = Layer.effect(
  ServerAuth,
  Effect.gen(function* () {
    const config = yield* ServerConfig
    return yield* makeServerAuthShape(config)
  })
)
