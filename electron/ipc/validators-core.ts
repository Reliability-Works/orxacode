export function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

export function assertStringArray(value: unknown, field: string, maxItems = 32): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${field} exceeds maximum item count (${maxItems})`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${field}[${index}] must be a non-empty string`);
    }
    if (item.length > 2048) {
      throw new Error(`${field}[${index}] is too long`);
    }
    return item;
  });
}

export function assertOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return assertString(value, field);
}

export function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}
