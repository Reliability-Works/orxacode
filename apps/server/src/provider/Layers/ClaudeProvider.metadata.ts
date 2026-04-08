import type { ServerProviderModel } from '@orxa-code/contracts'
import { Option, Result, Schema, Effect } from 'effect'
import { decodeJsonResult } from '@orxa-code/shared/schemaJson'
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'

import { type CommandResult } from '../providerSnapshot'

/** Keys that directly hold a subscription/plan identifier. */
const SUBSCRIPTION_TYPE_KEYS = [
  'subscriptionType',
  'subscription_type',
  'plan',
  'tier',
  'planType',
  'plan_type',
] as const

/** Keys whose value may be a nested object containing subscription info. */
const SUBSCRIPTION_CONTAINER_KEYS = ['account', 'subscription', 'user', 'billing'] as const
const AUTH_METHOD_KEYS = ['authMethod', 'auth_method'] as const
const AUTH_METHOD_CONTAINER_KEYS = ['auth', 'account', 'session'] as const
const PREMIUM_SUBSCRIPTION_TYPES = new Set([
  'max',
  'maxplan',
  'max5',
  'max20',
  'enterprise',
  'team',
])
const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000
const decodeUnknownJson = decodeJsonResult(Schema.Unknown)

const asNonEmptyString = (v: unknown): Option.Option<string> =>
  typeof v === 'string' && v.length > 0 ? Option.some(v) : Option.none()

const asRecord = (v: unknown): Option.Option<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !globalThis.Array.isArray(v)
    ? Option.some(v as Record<string, unknown>)
    : Option.none()

function findSubscriptionType(value: unknown): Option.Option<string> {
  if (globalThis.Array.isArray(value)) {
    return Option.firstSomeOf(value.map(findSubscriptionType))
  }

  return asRecord(value).pipe(
    Option.flatMap(record => {
      const direct = Option.firstSomeOf(
        SUBSCRIPTION_TYPE_KEYS.map(key => asNonEmptyString(record[key]))
      )
      if (Option.isSome(direct)) return direct

      return Option.firstSomeOf(
        SUBSCRIPTION_CONTAINER_KEYS.map(key =>
          asRecord(record[key]).pipe(Option.flatMap(findSubscriptionType))
        )
      )
    })
  )
}

function findAuthMethod(value: unknown): Option.Option<string> {
  if (globalThis.Array.isArray(value)) {
    return Option.firstSomeOf(value.map(findAuthMethod))
  }

  return asRecord(value).pipe(
    Option.flatMap(record => {
      const direct = Option.firstSomeOf(AUTH_METHOD_KEYS.map(key => asNonEmptyString(record[key])))
      if (Option.isSome(direct)) return direct

      return Option.firstSomeOf(
        AUTH_METHOD_CONTAINER_KEYS.map(key =>
          asRecord(record[key]).pipe(Option.flatMap(findAuthMethod))
        )
      )
    })
  )
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function claudeSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined

  switch (normalized) {
    case 'max':
    case 'maxplan':
    case 'max5':
    case 'max20':
      return 'Max'
    case 'enterprise':
      return 'Enterprise'
    case 'team':
      return 'Team'
    case 'pro':
      return 'Pro'
    case 'free':
      return 'Free'
    default:
      return toTitleCaseWords(subscriptionType!)
  }
}

function normalizeClaudeAuthMethod(authMethod: string | undefined): string | undefined {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined
  if (normalized === 'apikey') return 'apiKey'
  return undefined
}

export function extractSubscriptionTypeFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim())
  if (Result.isFailure(parsed)) return undefined
  return Option.getOrUndefined(findSubscriptionType(parsed.success))
}

export function extractClaudeAuthMethodFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim())
  if (Result.isFailure(parsed)) return undefined
  return Option.getOrUndefined(findAuthMethod(parsed.success))
}

export function claudeAuthMetadata(input: {
  readonly subscriptionType: string | undefined
  readonly authMethod: string | undefined
}): { readonly type: string; readonly label: string } | undefined {
  if (normalizeClaudeAuthMethod(input.authMethod) === 'apiKey') {
    return {
      type: 'apiKey',
      label: 'Claude API Key',
    }
  }

  if (input.subscriptionType) {
    const subscriptionLabel = claudeSubscriptionLabel(input.subscriptionType)
    return {
      type: input.subscriptionType,
      label: `Claude ${subscriptionLabel ?? toTitleCaseWords(input.subscriptionType)} Subscription`,
    }
  }

  return undefined
}

export function adjustModelsForSubscription(
  baseModels: ReadonlyArray<ServerProviderModel>,
  subscriptionType: string | undefined
): ReadonlyArray<ServerProviderModel> {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized || !PREMIUM_SUBSCRIPTION_TYPES.has(normalized)) {
    return baseModels
  }

  return baseModels.map(model => {
    const caps = model.capabilities
    if (!caps || caps.contextWindowOptions.length === 0) return model

    return {
      ...model,
      capabilities: {
        ...caps,
        contextWindowOptions: caps.contextWindowOptions.map(opt =>
          opt.value === '1m'
            ? { value: opt.value, label: opt.label, isDefault: true as const }
            : { value: opt.value, label: opt.label }
        ),
      },
    }
  })
}

export const probeClaudeCapabilities = (binaryPath: string) => {
  const abort = new AbortController()
  return Effect.tryPromise(async () => {
    const q = claudeQuery({
      prompt: '.',
      options: {
        persistSession: false,
        pathToClaudeCodeExecutable: binaryPath,
        abortController: abort,
        maxTurns: 0,
        settingSources: [],
        allowedTools: [],
        stderr: () => {},
      },
    })
    const init = await q.initializationResult()
    return { subscriptionType: init.account?.subscriptionType }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort()
      })
    ),
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map(result => {
      if (Result.isFailure(result)) return undefined
      return Option.isSome(result.success) ? result.success.value : undefined
    })
  )
}
