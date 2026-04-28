import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { Command } from 'effect/unstable/cli'

import { NetService } from '@orxa-code/shared/Net'
import { cli } from './cli'
import { reapOpencodeOrphans } from './provider/opencodeOrphanReaper'
import { installOpencodeServerPoolShutdownHandlers } from './provider/opencodeServerPool'
import { version } from '../package.json' with { type: 'json' }

installOpencodeServerPoolShutdownHandlers()
void reapOpencodeOrphans()

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer)

Command.run(cli, { version }).pipe(
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
  NodeRuntime.runMain
)
