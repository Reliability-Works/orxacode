/**
 * Shared markdown-to-HTML renderer used by MessageFeed, CodexPane, and chat components.
 * Handles the subset of Markdown commonly present in AI assistant responses.
 */
export type ParsedFileReference = {
  raw: string;
  path: string;
  basename: string;
  lineLabel?: string;
};

export function looksLikeFilePath(value: string) {
  if (!value || /\s{2,}/.test(value)) {
    return false;
  }
  if (/^(https?:|mailto:)/i.test(value)) {
    return false;
  }
  if (value.includes("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  return /\.[A-Za-z0-9._-]+$/.test(value);
}

export function parseFileReference(input: string): ParsedFileReference | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  let path = raw;
  let lineLabel: string | undefined;

  const hashLineMatch = path.match(/(#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/i);
  if (hashLineMatch) {
    lineLabel = hashLineMatch[1]!;
    path = path.slice(0, -hashLineMatch[1]!.length);
  } else {
    const colonLineMatch = path.match(/(:\d+(?::\d+)?(?:-\d+(?::\d+)?)?)$/);
    if (colonLineMatch && path.includes("/")) {
      lineLabel = colonLineMatch[1]!;
      path = path.slice(0, -colonLineMatch[1]!.length);
    }
  }

  const normalizedPath = path
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");

  if (!looksLikeFilePath(normalizedPath)) {
    return null;
  }

  const basename = normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
  if (!basename) {
    return null;
  }

  return {
    raw,
    path: normalizedPath,
    basename,
    lineLabel,
  };
}

