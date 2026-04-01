export function compactText(value: string, maxLength = 92) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`
}

export function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null
  }
  if (typeof value === 'string') {
    return parseJsonRecord(value.trim())
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function extractStringByKeys(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const nested = extractStringByKeys(value, keys)
      if (nested) {
        return nested
      }
    }
    return null
  }
  const record = input as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  for (const value of Object.values(record)) {
    const nested = extractStringByKeys(value, keys)
    if (nested) {
      return nested
    }
  }
  return null
}
