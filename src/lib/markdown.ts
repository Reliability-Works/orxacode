/**
 * Shared markdown-to-HTML renderer used by MessageFeed, CodexPane, and chat components.
 * Handles the subset of Markdown commonly present in AI assistant responses.
 */
export function renderMarkdownText(text: string): string {
  const html = text
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Fenced code blocks (must come before inline code)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headings (order: h3, h2, h1 to avoid partial matches)
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    // Links (only allow http/https URLs to prevent javascript: XSS)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      const trimmed = url.trim().toLowerCase();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:")) {
        return `<a href="${url}" class="md-link" rel="noopener noreferrer">${label}</a>`;
      }
      return `${label} (${url})`;
    })
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="md-hr" />')
    // Preserve newlines
    .replace(/\n/g, "<br />");
  return html;
}
