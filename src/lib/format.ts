/**
 * Returns a relative timestamp from the provided unix epoch milliseconds.
 */
export function timeAgo(updatedAt: number): string {
  const deltaMs = Date.now() - updatedAt;
  if (deltaMs < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats a number using compact notation (for example, 1.2K or 3M).
 */
export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Formats a numeric value as USD currency.
 */
export function money(value: number): string {
  if (value === 0) {
    return "$0";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

/**
 * Removes a provider prefix from model identifiers when present.
 */
export function trimProviderPrefix(model: string): string {
  const slashIndex = model.indexOf("/");
  if (slashIndex < 0) {
    return model;
  }
  return model.slice(slashIndex + 1);
}
