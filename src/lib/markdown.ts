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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function looksLikeFilePath(value: string) {
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

export function renderFileReferenceHtml(input: string): string {
  const parsed = parseFileReference(input);
  if (!parsed) {
    return escapeHtml(input);
  }

  return `<a href="#" class="md-file-link" data-orxa-file-ref="${escapeAttribute(parsed.raw)}"><span class="md-file-link-name">${escapeHtml(parsed.basename)}</span>${parsed.lineLabel ? `<span class="md-file-link-line">${escapeHtml(parsed.lineLabel)}</span>` : ""}</a>`;
}

export function renderMarkdownText(text: string): string {
  const html = text
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Fenced code blocks (must come before inline code)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>')
    // Links (only allow http/https URLs to prevent javascript: XSS)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      const trimmed = url.trim().toLowerCase();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:")) {
        return `<a href="${url}" class="md-link" rel="noopener noreferrer">${label}</a>`;
      }
      return renderFileReferenceHtml(url);
    })
    // Inline code
    .replace(/`([^`]+)`/g, (_match, code: string) => {
      return parseFileReference(code)
        ? renderFileReferenceHtml(code)
        : `<code class="md-inline-code">${code}</code>`;
    })
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headings (order: h3, h2, h1 to avoid partial matches)
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="md-hr" />')
    // Preserve newlines
    .replace(/\n/g, "<br />");
  return html;
}
