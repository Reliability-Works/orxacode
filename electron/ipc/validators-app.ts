import { assertString } from "./validators-core";

export function assertExternalUrl(value: unknown): string {
  const raw = assertString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid external URL");
  }
  if (!["https:", "http:", "mailto:", "file:"].includes(parsed.protocol)) {
    throw new Error("Unsupported external URL scheme");
  }
  return parsed.toString();
}
