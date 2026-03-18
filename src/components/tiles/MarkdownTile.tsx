import { useCallback, useState } from "react";
import { BookOpen, FolderOpen } from "lucide-react";
import { CanvasTileComponent } from "../CanvasTile";
import { tilePathBasename, type CanvasTileComponentProps } from "./tile-shared";

type MarkdownTileProps = CanvasTileComponentProps;

/**
 * Minimal markdown-to-HTML renderer. Handles headings, bold, italic,
 * inline code, fenced code blocks, unordered lists, ordered lists,
 * blockquotes, horizontal rules, and paragraphs.
 *
 * This intentionally avoids any external dependency.
 */
function renderMarkdown(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inList: "ul" | "ol" | null = null;

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function applyInline(text: string): string {
    // Bold (**text** or __text__)
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    // Italic (*text* or _text_)
    text = text.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
    text = text.replace(/_([^_]+?)_/g, "<em>$1</em>");
    // Inline code
    text = text.replace(/`([^`]+?)`/g, "<code>$1</code>");
    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return text;
  }

  function closeList() {
    if (inList === "ul") out.push("</ul>");
    if (inList === "ol") out.push("</ol>");
    inList = null;
  }

  for (const rawLine of lines) {
    const line = rawLine;

    // Fenced code block toggle
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Close block
        out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ""}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
        codeLang = "";
      } else {
        closeList();
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${applyInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push("<hr />");
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${applyInline(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${applyInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${applyInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Empty line — close any open list, paragraph break
    if (line.trim() === "") {
      closeList();
      out.push("");
      continue;
    }

    // Plain paragraph line
    closeList();
    out.push(`<p>${applyInline(escapeHtml(line))}</p>`);
  }

  // Close any open code block or list
  if (inCodeBlock && codeLines.length > 0) {
    out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeList();

  return out.join("\n");
}

const PLACEHOLDER_MARKDOWN = `# Markdown Preview

Open a file to preview rendered markdown here.

- Supports **bold**, *italic*, \`inline code\`
- Fenced code blocks
- Ordered and unordered lists
- Headings h1--h6
`;

export function MarkdownTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: MarkdownTileProps) {
  const filePath = typeof tile.meta.filePath === "string" ? tile.meta.filePath : "";
  const content = typeof tile.meta.content === "string" ? tile.meta.content : PLACEHOLDER_MARKDOWN;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileName = filePath ? tilePathBasename(filePath, "untitled.md") : undefined;
  const html = renderMarkdown(content);

  const handleOpenFile = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.orxa?.app : undefined;
    if (!bridge?.openFile) return;

    try {
      setIsLoading(true);
      setError(null);
      const result = await bridge.openFile({
        title: "Open Markdown File",
        filters: [{ name: "Markdown", extensions: ["md", "mdx", "markdown", "txt"] }],
      });
      if (!result) {
        setIsLoading(false);
        return;
      }

      // Read the file content — try via readProjectFile first, fall back to reading via the path
      let fileContent = "";
      try {
        // Use fetch with file:// protocol to read the file in Electron
        const resp = await fetch(result.url);
        fileContent = await resp.text();
      } catch {
        fileContent = `*Could not read file: ${result.path}*`;
      }

      onUpdate(tile.id, {
        meta: { ...tile.meta, filePath: result.path, content: fileContent },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [tile.id, tile.meta, onUpdate]);

  const openFileButton = (
    <button
      className="markdown-tile-open-btn"
      onClick={() => void handleOpenFile()}
      disabled={isLoading}
      title="Open markdown file"
    >
      <FolderOpen size={11} />
      <span>{isLoading ? "opening..." : "open file"}</span>
    </button>
  );

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<BookOpen size={12} />}
      label="markdown preview"
      iconColor="var(--text-tertiary, #737373)"
      metadata={fileName}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="markdown-tile-body">
        <div className="markdown-tile-toolbar">
          {openFileButton}
          {error && <span className="markdown-tile-error">{error}</span>}
        </div>
        <div
          className="markdown-tile-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </CanvasTileComponent>
  );
}
