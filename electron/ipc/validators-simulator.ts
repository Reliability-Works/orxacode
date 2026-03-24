export function assertSimulatorUdid(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected non-empty simulator UDID string");
  }
  return value;
}
