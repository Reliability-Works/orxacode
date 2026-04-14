import { Effect, Logger, References, Layer } from 'effect'

import { ServerConfig } from './config'
import { isDevBuild } from './runtimeMode'

export const ServerLoggerLive = Effect.gen(function* () {
  const config = yield* ServerConfig
  const { serverLogPath } = config

  const fileLogger = Logger.formatSimple.pipe(Logger.toFile(serverLogPath))
  const minimumLogLevelLayer = Layer.succeed(References.MinimumLogLevel, config.logLevel)
  // Packaged builds log to the rotating file only. The desktop shell captures
  // backend stdout into its own rotating log for crash diagnostics, so
  // `consolePretty` just doubles the I/O and retains formatted strings in
  // memory for no user-visible benefit.
  const sinks = isDevBuild() ? [Logger.consolePretty(), fileLogger] : [fileLogger]
  const loggerLayer = Logger.layer(sinks, { mergeWithExisting: false })

  return Layer.mergeAll(loggerLayer, minimumLogLevelLayer)
}).pipe(Layer.unwrap)
