/**
 * Static fallback registry of model id → context window (input tokens).
 *
 * Used by every provider adapter as a last-resort source for the composer's
 * "context window remaining" meter. The runtime SDK is the preferred source
 * (Claude exposes `result.modelUsage.contextWindow`, Codex *sometimes* emits
 * `model_context_window`, opencode exposes `model.limit.context` via
 * `client.config.providers()`); when those are missing or arrive late, this
 * map keeps the meter functional instead of falling back to raw token counts.
 *
 * Keys are normalized via `normalizeContextWindowModelKey`: lowercased,
 * stripped of common suffixes (`-latest`, vendor prefixes like
 * `anthropic/`, opencode model selectors like `[1m]`), so a single registry
 * entry covers small variations in model id formatting between SDKs.
 *
 * Numbers reflect the *input* context window per provider docs at the time
 * of writing; output token caps are intentionally not modeled here. Update
 * this map when providers ship new models or expand limits.
 *
 * @module modelContextWindow
 */

const CLAUDE_200K = 200_000
const CLAUDE_1M = 1_000_000
const GPT_5_CONTEXT = 400_000
const KIMI_K2_CONTEXT = 256_000
const GROK_CONTEXT = 256_000
const GEMINI_2_5_CONTEXT = 1_048_576
const GEMINI_2_FLASH_CONTEXT = 1_048_576
const QWEN_3_CODER_CONTEXT = 256_000
const DEEPSEEK_V3_CONTEXT = 128_000
const GLM_45_CONTEXT = 128_000

/**
 * Map of normalized model id → input context window in tokens.
 * Keys are lowercase and free of vendor prefixes / variant suffixes. See
 * `normalizeContextWindowModelKey` for the normalization rules.
 */
const CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // ── Claude (anthropic) ──────────────────────────────────────────────
  'claude-opus-4-6': CLAUDE_200K,
  'claude-opus-4-5': CLAUDE_200K,
  'claude-opus-4-1': CLAUDE_200K,
  'claude-opus-4': CLAUDE_200K,
  'claude-sonnet-4-6': CLAUDE_1M,
  'claude-sonnet-4-5': CLAUDE_1M,
  'claude-sonnet-4': CLAUDE_1M,
  'claude-haiku-4-5': CLAUDE_200K,
  'claude-3-7-sonnet': CLAUDE_200K,
  'claude-3-5-sonnet': CLAUDE_200K,
  'claude-3-5-haiku': CLAUDE_200K,

  // ── OpenAI / Codex (gpt-5 family) ───────────────────────────────────
  'gpt-5.4': GPT_5_CONTEXT,
  'gpt-5.4-mini': GPT_5_CONTEXT,
  'gpt-5.3': GPT_5_CONTEXT,
  'gpt-5.3-codex': GPT_5_CONTEXT,
  'gpt-5.3-codex-spark': GPT_5_CONTEXT,
  'gpt-5.2': GPT_5_CONTEXT,
  'gpt-5.2-codex': GPT_5_CONTEXT,
  'gpt-5.1': GPT_5_CONTEXT,
  'gpt-5': GPT_5_CONTEXT,
  'gpt-5-codex': GPT_5_CONTEXT,

  // ── Opencode-routed providers (top picks) ───────────────────────────
  // Moonshot Kimi K2.x — opencode default for many users.
  'kimi-k2.5': KIMI_K2_CONTEXT,
  'kimi-k2-0905': KIMI_K2_CONTEXT,
  'kimi-k2-0711': KIMI_K2_CONTEXT,
  'moonshotai/kimi-k2-instruct': KIMI_K2_CONTEXT,
  // xAI Grok via opencode
  'grok-4': GROK_CONTEXT,
  'grok-code-fast-1': GROK_CONTEXT,
  // Google Gemini via opencode
  'gemini-2.5-pro': GEMINI_2_5_CONTEXT,
  'gemini-2.5-flash': GEMINI_2_5_CONTEXT,
  'gemini-2.0-flash': GEMINI_2_FLASH_CONTEXT,
  // Qwen Coder via opencode
  'qwen3-coder': QWEN_3_CODER_CONTEXT,
  'qwen3-coder-plus': QWEN_3_CODER_CONTEXT,
  // DeepSeek via opencode
  'deepseek-chat': DEEPSEEK_V3_CONTEXT,
  'deepseek-coder': DEEPSEEK_V3_CONTEXT,
  'deepseek-v3': DEEPSEEK_V3_CONTEXT,
  // Z.ai GLM via opencode
  'glm-4.5': GLM_45_CONTEXT,
  'glm-4.6': GLM_45_CONTEXT,
}

/**
 * Normalize a model id for registry lookup.
 *
 *  - Lowercases the input.
 *  - Strips opencode's bracketed variant suffix (e.g. `claude-sonnet-4-5[1m]`
 *    → `claude-sonnet-4-5`) so `1m`-context Claude variants match the same
 *    registry entry.
 *  - Strips vendor prefixes Codex/opencode sometimes emit
 *    (`anthropic/claude-sonnet-4-5`, `openai/gpt-5.3`) so the bare model id
 *    matches.
 *  - Drops a trailing `-latest` suffix.
 *  - Trims surrounding whitespace.
 */
export function normalizeContextWindowModelKey(rawModelId: string): string {
  const trimmed = rawModelId.trim().toLowerCase()
  if (trimmed.length === 0) return trimmed
  // Strip "[1m]" / "[200k]" / etc. that Claude/opencode use to express variants.
  const noBracket = trimmed.replace(/\[[^\]]*\]\s*$/g, '')
  // Strip vendor/router prefix ("anthropic/", "openai/", "moonshotai/").
  const lastSlash = noBracket.lastIndexOf('/')
  const noVendor =
    lastSlash >= 0 && lastSlash < noBracket.length - 1
      ? // Keep an explicit allow-list of well-known model id prefixes that we
        // want to preserve (the registry uses the prefixed key for them).
        noBracket.startsWith('moonshotai/')
        ? noBracket
        : noBracket.slice(lastSlash + 1)
      : noBracket
  return noVendor.replace(/-latest$/g, '').trim()
}

/**
 * Look up a model's input context window in tokens, falling back to the
 * static registry when the SDK didn't supply one. Returns `undefined` for
 * unknown models so callers can decide whether to omit `maxTokens` from the
 * runtime usage payload.
 */
export function lookupModelContextWindow(modelId: string | null | undefined): number | undefined {
  if (typeof modelId !== 'string') return undefined
  const key = normalizeContextWindowModelKey(modelId)
  if (key.length === 0) return undefined
  const value = CONTEXT_WINDOWS[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Pick the "best" context window value: prefer an SDK-supplied number when
 * present and valid, otherwise fall back to the static registry. Returns
 * `undefined` only when neither source had anything usable.
 */
export function resolveModelContextWindow(input: {
  readonly fromSdk?: number | null | undefined
  readonly modelId?: string | null | undefined
}): number | undefined {
  const sdk = input.fromSdk
  if (typeof sdk === 'number' && Number.isFinite(sdk) && sdk > 0) {
    return sdk
  }
  return lookupModelContextWindow(input.modelId)
}
