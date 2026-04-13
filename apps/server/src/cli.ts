import { NetService, type NetServiceShape } from '@orxa-code/shared/Net'
import { Config, Effect, LogLevel, Option, Schema } from 'effect'
import { Command, Flag, GlobalFlag } from 'effect/unstable/cli'

import {
  DEFAULT_PORT,
  deriveServerPaths,
  ensureServerDirectories,
  resolveStaticDir,
  ServerConfig,
  type ServerDerivedPaths,
  RuntimeMode,
  type ServerConfigShape,
} from './config'
import { BootstrapError, readBootstrapEnvelope } from './bootstrap'
import { resolveBaseDir } from './os-jank'
import { runServer } from './server'

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))

const BootstrapEnvelopeSchema = Schema.Struct({
  mode: Schema.optional(RuntimeMode),
  port: Schema.optional(PortSchema),
  host: Schema.optional(Schema.String),
  orxaHome: Schema.optional(Schema.String),
  devUrl: Schema.optional(Schema.URLFromString),
  noBrowser: Schema.optional(Schema.Boolean),
  authToken: Schema.optional(Schema.String),
  remoteAccessBootstrapToken: Schema.optional(Schema.String),
  remoteAccessEnvironmentId: Schema.optional(Schema.String),
  autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
  logWebSocketEvents: Schema.optional(Schema.Boolean),
})

const modeFlag = Flag.choice('mode', RuntimeMode.literals).pipe(
  Flag.withDescription('Runtime mode. `desktop` keeps loopback defaults unless overridden.'),
  Flag.optional
)
const portFlag = Flag.integer('port').pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription('Port for the HTTP/WebSocket server.'),
  Flag.optional
)
const hostFlag = Flag.string('host').pipe(
  Flag.withDescription('Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP).'),
  Flag.optional
)
const baseDirFlag = Flag.string('base-dir').pipe(
  Flag.withDescription('Base directory path (equivalent to ORXA_HOME).'),
  Flag.optional
)
const devUrlFlag = Flag.string('dev-url').pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription('Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL).'),
  Flag.optional
)
const noBrowserFlag = Flag.boolean('no-browser').pipe(
  Flag.withDescription('Disable automatic browser opening.'),
  Flag.optional
)
const authTokenFlag = Flag.string('auth-token').pipe(
  Flag.withDescription('Auth token required for WebSocket connections.'),
  Flag.withAlias('token'),
  Flag.optional
)
const bootstrapFdFlag = Flag.integer('bootstrap-fd').pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription('Read one-time bootstrap secrets from the given file descriptor.'),
  Flag.optional
)
const autoBootstrapProjectFromCwdFlag = Flag.boolean('auto-bootstrap-project-from-cwd').pipe(
  Flag.withDescription(
    'Create a project for the current working directory on startup when missing.'
  ),
  Flag.optional
)
const logWebSocketEventsFlag = Flag.boolean('log-websocket-events').pipe(
  Flag.withDescription(
    'Emit server-side logs for outbound WebSocket push traffic (equivalent to ORXA_LOG_WS_EVENTS).'
  ),
  Flag.withAlias('log-ws-events'),
  Flag.optional
)

const EnvServerConfig = Config.all({
  logLevel: Config.logLevel('ORXA_LOG_LEVEL').pipe(Config.withDefault('Info')),
  mode: Config.schema(RuntimeMode, 'ORXA_MODE').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  port: Config.port('ORXA_PORT').pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string('ORXA_HOST').pipe(Config.option, Config.map(Option.getOrUndefined)),
  orxaHome: Config.string('ORXA_HOME').pipe(Config.option, Config.map(Option.getOrUndefined)),
  devUrl: Config.url('VITE_DEV_SERVER_URL').pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean('ORXA_NO_BROWSER').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  authToken: Config.string('ORXA_AUTH_TOKEN').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  remoteAccessBootstrapToken: Config.string('ORXA_REMOTE_ACCESS_BOOTSTRAP_TOKEN').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  remoteAccessEnvironmentId: Config.string('ORXA_REMOTE_ACCESS_ENVIRONMENT_ID').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  bootstrapFd: Config.int('ORXA_BOOTSTRAP_FD').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  autoBootstrapProjectFromCwd: Config.boolean('ORXA_AUTO_BOOTSTRAP_PROJECT_FROM_CWD').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
  logWebSocketEvents: Config.boolean('ORXA_LOG_WS_EVENTS').pipe(
    Config.option,
    Config.map(Option.getOrUndefined)
  ),
})

interface CliServerFlags {
  readonly mode: Option.Option<RuntimeMode>
  readonly port: Option.Option<number>
  readonly host: Option.Option<string>
  readonly baseDir: Option.Option<string>
  readonly devUrl: Option.Option<URL>
  readonly noBrowser: Option.Option<boolean>
  readonly authToken: Option.Option<string>
  readonly bootstrapFd: Option.Option<number>
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>
  readonly logWebSocketEvents: Option.Option<boolean>
}

interface ResolvedCliEnvConfig {
  readonly logLevel: LogLevel.LogLevel
  readonly mode: RuntimeMode | undefined
  readonly port: number | undefined
  readonly host: string | undefined
  readonly orxaHome: string | undefined
  readonly devUrl: URL | undefined
  readonly noBrowser: boolean | undefined
  readonly authToken: string | undefined
  readonly remoteAccessBootstrapToken: string | undefined
  readonly remoteAccessEnvironmentId: string | undefined
  readonly bootstrapFd: number | undefined
  readonly autoBootstrapProjectFromCwd: boolean | undefined
  readonly logWebSocketEvents: boolean | undefined
}

interface BootstrapEnvelope {
  readonly mode?: RuntimeMode | undefined
  readonly port?: number | undefined
  readonly host?: string | undefined
  readonly orxaHome?: string | undefined
  readonly devUrl?: URL | undefined
  readonly noBrowser?: boolean | undefined
  readonly authToken?: string | undefined
  readonly remoteAccessBootstrapToken?: string | undefined
  readonly remoteAccessEnvironmentId?: string | undefined
  readonly autoBootstrapProjectFromCwd?: boolean | undefined
  readonly logWebSocketEvents?: boolean | undefined
}

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue)

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values)

const bootstrapOption = <Value>(
  envelope: Option.Option<BootstrapEnvelope>,
  selector: (bootstrap: BootstrapEnvelope) => Value | undefined
): Option.Option<Value> =>
  Option.flatMap(envelope, bootstrap => Option.fromUndefinedOr(selector(bootstrap)))

const envOption = <Value>(value: Value | undefined): Option.Option<Value> =>
  Option.fromUndefinedOr(value)

const resolveWithPrecedence = <Value>(
  flagsValue: Option.Option<Value>,
  envValue: Value | undefined,
  bootstrapValue: Option.Option<Value>
): Option.Option<Value> => resolveOptionPrecedence(flagsValue, envOption(envValue), bootstrapValue)

const resolveMode = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
): RuntimeMode =>
  Option.getOrElse(
    resolveWithPrecedence(
      flags.mode,
      env.mode,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.mode)
    ),
    () => 'web'
  )

const resolvePort = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>,
  mode: RuntimeMode,
  findAvailablePort: NetServiceShape['findAvailablePort']
) =>
  Option.match(
    resolveWithPrecedence(
      flags.port,
      env.port,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.port)
    ),
    {
      onSome: value => Effect.succeed(value),
      onNone: () =>
        mode === 'desktop' ? Effect.succeed(DEFAULT_PORT) : findAvailablePort(DEFAULT_PORT),
    }
  )

const resolveDevUrl = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
) =>
  Option.getOrElse(
    resolveWithPrecedence(
      flags.devUrl,
      env.devUrl,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.devUrl)
    ),
    () => undefined
  )

const resolveBaseDirInput = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
) =>
  Option.getOrUndefined(
    resolveWithPrecedence(
      flags.baseDir,
      env.orxaHome,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.orxaHome)
    )
  )

const resolveNoBrowser = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>,
  mode: RuntimeMode
) =>
  resolveBooleanFlag(
    flags.noBrowser,
    Option.getOrElse(
      resolveOptionPrecedence(
        envOption(env.noBrowser),
        bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.noBrowser)
      ),
      () => mode === 'desktop'
    )
  )

const resolveAuthToken = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
) =>
  Option.getOrUndefined(
    resolveWithPrecedence(
      flags.authToken,
      env.authToken,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.authToken)
    )
  )

const resolveRemoteAccessBootstrapToken = (
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
) =>
  Option.getOrUndefined(
    resolveOptionPrecedence(
      envOption(env.remoteAccessBootstrapToken),
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.remoteAccessBootstrapToken)
    )
  )

const resolveRemoteAccessEnvironmentId = (
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>
) =>
  Option.getOrUndefined(
    resolveOptionPrecedence(
      envOption(env.remoteAccessEnvironmentId),
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.remoteAccessEnvironmentId)
    )
  )

const resolveAutoBootstrapProjectFromCwd = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>,
  mode: RuntimeMode
) =>
  resolveBooleanFlag(
    flags.autoBootstrapProjectFromCwd,
    Option.getOrElse(
      resolveOptionPrecedence(
        envOption(env.autoBootstrapProjectFromCwd),
        bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.autoBootstrapProjectFromCwd)
      ),
      () => mode === 'web'
    )
  )

const resolveLogWebSocketEvents = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>,
  devUrl: URL | undefined
) =>
  resolveBooleanFlag(
    flags.logWebSocketEvents,
    Option.getOrElse(
      resolveOptionPrecedence(
        envOption(env.logWebSocketEvents),
        bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.logWebSocketEvents)
      ),
      () => Boolean(devUrl)
    )
  )

const resolveHost = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig,
  bootstrapEnvelope: Option.Option<BootstrapEnvelope>,
  mode: RuntimeMode
) =>
  Option.getOrElse(
    resolveWithPrecedence(
      flags.host,
      env.host,
      bootstrapOption(bootstrapEnvelope, bootstrap => bootstrap.host)
    ),
    () => (mode === 'desktop' ? '127.0.0.1' : undefined)
  )

const resolveCliLogLevel = (
  cliLogLevel: Option.Option<LogLevel.LogLevel>,
  env: ResolvedCliEnvConfig
) => Option.getOrElse(cliLogLevel, () => env.logLevel)

const readBootstrapConfig = (
  flags: CliServerFlags,
  env: ResolvedCliEnvConfig
): Effect.Effect<Option.Option<BootstrapEnvelope>, BootstrapError> => {
  const bootstrapFd = Option.getOrUndefined(flags.bootstrapFd) ?? env.bootstrapFd
  return bootstrapFd !== undefined
    ? readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd)
    : Effect.succeed(Option.none())
}

const buildServerConfig = (input: {
  logLevel: LogLevel.LogLevel
  mode: RuntimeMode
  port: number
  baseDir: string
  derivedPaths: ServerDerivedPaths
  host: string | undefined
  staticDir: string | undefined
  devUrl: URL | undefined
  noBrowser: boolean
  authToken: string | undefined
  remoteAccessBootstrapToken: string | undefined
  remoteAccessEnvironmentId: string | undefined
  autoBootstrapProjectFromCwd: boolean
  logWebSocketEvents: boolean
}): ServerConfigShape => ({
  logLevel: input.logLevel,
  mode: input.mode,
  port: input.port,
  cwd: process.cwd(),
  baseDir: input.baseDir,
  ...input.derivedPaths,
  host: input.host,
  staticDir: input.staticDir,
  devUrl: input.devUrl,
  noBrowser: input.noBrowser,
  authToken: input.authToken,
  remoteAccessBootstrapToken: input.remoteAccessBootstrapToken,
  remoteAccessEnvironmentId: input.remoteAccessEnvironmentId,
  autoBootstrapProjectFromCwd: input.autoBootstrapProjectFromCwd,
  logWebSocketEvents: input.logWebSocketEvents,
})

const runCliCommand = (flags: CliServerFlags) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel
    const config = yield* resolveServerConfig(flags, logLevel)
    return yield* runServer.pipe(Effect.provideService(ServerConfig, config))
  })

export const resolveServerConfig = (
  flags: CliServerFlags,
  cliLogLevel: Option.Option<LogLevel.LogLevel>
) =>
  Effect.gen(function* () {
    const { findAvailablePort } = yield* NetService
    const env: ResolvedCliEnvConfig = yield* EnvServerConfig
    const bootstrapEnvelope = yield* readBootstrapConfig(flags, env)

    const mode = resolveMode(flags, env, bootstrapEnvelope)
    const port = yield* resolvePort(flags, env, bootstrapEnvelope, mode, findAvailablePort)
    const devUrl = resolveDevUrl(flags, env, bootstrapEnvelope)
    const baseDir = yield* resolveBaseDir(resolveBaseDirInput(flags, env, bootstrapEnvelope))
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl)
    yield* ensureServerDirectories(derivedPaths)
    const noBrowser = resolveNoBrowser(flags, env, bootstrapEnvelope, mode)
    const authToken = resolveAuthToken(flags, env, bootstrapEnvelope)
    const remoteAccessBootstrapToken = resolveRemoteAccessBootstrapToken(env, bootstrapEnvelope)
    const remoteAccessEnvironmentId = resolveRemoteAccessEnvironmentId(env, bootstrapEnvelope)
    const autoBootstrapProjectFromCwd = resolveAutoBootstrapProjectFromCwd(
      flags,
      env,
      bootstrapEnvelope,
      mode
    )
    const logWebSocketEvents = resolveLogWebSocketEvents(flags, env, bootstrapEnvelope, devUrl)
    const staticDir = devUrl ? undefined : yield* resolveStaticDir()
    const host = resolveHost(flags, env, bootstrapEnvelope, mode)
    const logLevel = resolveCliLogLevel(cliLogLevel, env)

    return buildServerConfig({
      logLevel,
      mode,
      port,
      baseDir,
      derivedPaths,
      host,
      staticDir,
      devUrl,
      noBrowser,
      authToken,
      remoteAccessBootstrapToken,
      remoteAccessEnvironmentId,
      autoBootstrapProjectFromCwd,
      logWebSocketEvents,
    })
  })

const commandFlags = {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
} as const

const rootCommand = Command.make('orxa', commandFlags).pipe(
  Command.withDescription('Run the Orxa Code server.'),
  Command.withHandler(flags => runCliCommand(flags))
)

export const cli = rootCommand
