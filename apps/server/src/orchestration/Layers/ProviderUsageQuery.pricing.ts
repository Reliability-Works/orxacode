/**
 * Pricing tables and cost estimation helpers for {@link ProviderUsageQueryLive}.
 *
 * Prices are expressed as US dollars per million tokens. Entries are matched
 * against model ids via substring containment so a single row covers variants
 * like `claude-3-5-sonnet-20240620` and `claude-3-sonnet-latest`.
 *
 * @module ProviderUsageQuery.pricing
 */
export interface ModelPricing {
  readonly input: number
  readonly cachedInput?: number
  readonly output: number
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
  opus: { input: 15, output: 75 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  o1: { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'codex-mini': { input: 1.5, cachedInput: 0.375, output: 6 },
}

const FALLBACK_PRICING: ModelPricing = { input: 3, cachedInput: 0.3, output: 15 }

function pricingFor(model: string): ModelPricing {
  const lower = model.toLowerCase()
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) {
      return pricing
    }
  }
  return FALLBACK_PRICING
}

/**
 * Returns the estimated cost of a usage slice in **US dollars** (not cents).
 * Cached input is capped at total input because some providers double-count
 * cache reads inside the `input_tokens` total.
 */
export function estimateCostDollars(
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
): number {
  const pricing = pricingFor(model)
  const cached = Math.min(cachedInputTokens, inputTokens)
  const uncached = Math.max(0, inputTokens - cached)
  return (
    (uncached / 1_000_000) * pricing.input +
    (cached / 1_000_000) * (pricing.cachedInput ?? pricing.input) +
    (outputTokens / 1_000_000) * pricing.output
  )
}

export const dollarsToCents = (dollars: number): number => Math.max(0, Math.round(dollars * 100))
