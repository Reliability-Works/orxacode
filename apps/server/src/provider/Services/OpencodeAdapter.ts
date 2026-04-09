/**
 * OpencodeAdapter - Opencode implementation of the generic provider adapter contract.
 *
 * This service owns opencode app-server / SDK semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * Uses Effect `ServiceMap.Service` for dependency injection and returns the
 * shared provider-adapter error channel with `provider: "opencode"` context.
 *
 * @module OpencodeAdapter
 */
import type { OpencodeAgent } from '@orxa-code/contracts'
import type { Effect } from 'effect'
import { ServiceMap } from 'effect'

import type { ProviderAdapterError } from '../Errors.ts'
import type { ProviderAdapterShape } from './ProviderAdapter.ts'

/**
 * OpencodeAdapterShape - Service API for the Opencode provider adapter.
 *
 * Extends the generic provider adapter contract with the opencode-only
 * `listPrimaryAgents` method, which scans the user's config + data dirs
 * for primary agent files (md frontmatter or json) and returns the
 * deduped, sorted set. Cached internally inside the live layer with a
 * 5-minute TTL.
 */
export interface OpencodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: 'opencode'
  readonly listPrimaryAgents: () => Effect.Effect<ReadonlyArray<OpencodeAgent>>
}

/**
 * OpencodeAdapter - Service tag for Opencode provider adapter operations.
 */
export class OpencodeAdapter extends ServiceMap.Service<OpencodeAdapter, OpencodeAdapterShape>()(
  'orxacode/provider/Services/OpencodeAdapter'
) {}
