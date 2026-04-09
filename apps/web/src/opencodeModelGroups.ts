import { normalizeModelSlug } from '@orxa-code/shared/model'

export const OPENCODE_SUBPROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  zai: 'Z.ai',
  'zai-coding-plan': 'Z.ai Coding Plan',
  xai: 'xAI',
  mistral: 'Mistral',
  groq: 'Groq',
  meta: 'Meta',
  minimax: 'MiniMax',
}

export function stripOpencodeSubproviderPrefix(label: string): string {
  const slashIdx = label.indexOf('/')
  if (slashIdx <= 0) return label
  return label.slice(slashIdx + 1)
}

export function formatOpencodeSubprovider(id: string): string {
  const known = OPENCODE_SUBPROVIDER_LABELS[id]
  if (known) return known
  return id.length > 0 ? id[0]!.toUpperCase() + id.slice(1) : id
}

export interface OpencodeSubproviderGroup<T extends { slug: string }> {
  readonly providerId: string
  readonly label: string
  readonly options: ReadonlyArray<T>
}

export function groupOpencodeModelsBySubprovider<T extends { slug: string }>(
  modelOptions: ReadonlyArray<T>
): ReadonlyArray<OpencodeSubproviderGroup<T>> {
  const byProvider = new Map<string, Array<T>>()
  for (const option of modelOptions) {
    const slashIdx = option.slug.indexOf('/')
    const providerId = slashIdx > 0 ? option.slug.slice(0, slashIdx) : 'other'
    const bucket = byProvider.get(providerId)
    if (bucket) bucket.push(option)
    else byProvider.set(providerId, [option])
  }
  return [...byProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([providerId, options]) => ({
      providerId,
      label: formatOpencodeSubprovider(providerId),
      options,
    }))
}

export function normalizeOpencodeHiddenModelSlugs(
  modelSlugs: ReadonlyArray<string>
): ReadonlyArray<string> {
  const normalized = new Set<string>()
  for (const slug of modelSlugs) {
    const next = normalizeModelSlug(slug, 'opencode')
    if (next) {
      normalized.add(next)
    }
  }
  return [...normalized].sort((a, b) => a.localeCompare(b))
}

export function filterHiddenOpencodeModels<T extends { slug: string }>(
  modelOptions: ReadonlyArray<T>,
  hiddenModelSlugs: ReadonlyArray<string>
): ReadonlyArray<T> {
  const hidden = new Set(normalizeOpencodeHiddenModelSlugs(hiddenModelSlugs))
  if (hidden.size === 0) return modelOptions
  return modelOptions.filter(option => !hidden.has(option.slug))
}
