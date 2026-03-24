import { memo, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import htmlLang from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import xml from "react-syntax-highlighter/dist/esm/languages/prism/xml-doc";
import { ClipboardCopy, Check } from "lucide-react";
import { parseFileReference } from "../../lib/markdown";
import type { Components } from "react-markdown";

SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("html", htmlLang);
SyntaxHighlighter.registerLanguage("xml", xml);

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onOpenFileReference?: (reference: string) => void;
}

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }, [code]);

  return (
    <button
      type="button"
      className="md-code-block-copy"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
    </button>
  );
}

function FileReferenceLink({
  reference,
  label,
  onOpen,
}: {
  reference: string;
  label: string;
  onOpen?: (ref: string) => void;
}) {
  const parsed = parseFileReference(reference);
  if (!parsed) return <code className="md-inline-code">{label}</code>;

  return (
    <a
      href="#"
      className="md-file-link"
      onClick={(e) => {
        e.preventDefault();
        onOpen?.(parsed.raw);
      }}
    >
      <span className="md-file-link-name">{parsed.basename}</span>
      {parsed.lineLabel ? (
        <span className="md-file-link-line">{parsed.lineLabel}</span>
      ) : null}
    </a>
  );
}

function buildComponents(
  isStreaming: boolean,
  onOpenFileReference?: (reference: string) => void,
): Components {
  return {
    h1: ({ children, ...props }) => (
      <h1 className="md-h1" {...props}>{children}</h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 className="md-h2" {...props}>{children}</h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="md-h3" {...props}>{children}</h3>
    ),
    hr: (props) => <hr className="md-hr" {...props} />,
    a: ({ href, children, ...props }) => {
      if (href && !href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("mailto:")) {
        const parsed = parseFileReference(href);
        if (parsed) {
          return (
            <a
              href="#"
              className="md-file-link"
              onClick={(e) => {
                e.preventDefault();
                onOpenFileReference?.(parsed.raw);
              }}
              {...props}
            >
              <span className="md-file-link-name">{parsed.basename}</span>
              {parsed.lineLabel ? (
                <span className="md-file-link-line">{parsed.lineLabel}</span>
              ) : null}
            </a>
          );
        }
      }

      return (
        <a href={href} className="md-link" rel="noopener noreferrer" target="_blank" {...props}>
          {children}
        </a>
      );
    },
    pre: ({ children }) => {
      // Extract code text and language from the child code element
      let codeText = "";
      let language = "";

      const child = Array.isArray(children) ? children[0] : children;
      if (child && typeof child === "object" && "props" in child) {
        const codeProps = child.props as { children?: string; className?: string };
        codeText = typeof codeProps.children === "string" ? codeProps.children : "";
        const match = codeProps.className?.match(/language-(\w+)/);
        language = match ? match[1]! : "";
      }

      return (
        <div className="md-code-block-wrap">
          <div className="md-code-block-header">
            <span>{language || "text"}</span>
            <CodeBlockCopyButton code={codeText} />
          </div>
          <pre className="md-code-block">{children}</pre>
        </div>
      );
    },
    code: ({ children, className, ...props }) => {
      const match = className?.match(/language-(\w+)/);
      const language = match ? match[1]! : "";
      const codeString = String(children).replace(/\n$/, "");

      // Fenced code block (has a language class set by react-markdown)
      if (match) {
        if (isStreaming) {
          return <code className={className} {...props}>{children}</code>;
        }

        return (
          <SyntaxHighlighter
            language={language}
            useInlineStyles={false}
            PreTag="div"
            CodeTag="code"
          >
            {codeString}
          </SyntaxHighlighter>
        );
      }

      // Inline code — check for file reference
      const ref = parseFileReference(codeString);
      if (ref) {
        return (
          <FileReferenceLink
            reference={codeString}
            label={codeString}
            onOpen={onOpenFileReference}
          />
        );
      }

      return <code className="md-inline-code" {...props}>{children}</code>;
    },
  };
}

const remarkPlugins = [remarkGfm];

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming = false,
  onOpenFileReference,
}: MarkdownRendererProps) {
  const components = useMemo(
    () => buildComponents(isStreaming, onOpenFileReference),
    [isStreaming, onOpenFileReference],
  );

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {content}
    </ReactMarkdown>
  );
});
