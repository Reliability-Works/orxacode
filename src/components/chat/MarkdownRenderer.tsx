import { memo, useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import htmlLang from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import xml from 'react-syntax-highlighter/dist/esm/languages/prism/xml-doc'
import { ClipboardCopy, Check } from 'lucide-react'
import { parseFileReference } from '../../lib/markdown'

SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('yml', yaml)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('md', markdown)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('html', htmlLang)
SyntaxHighlighter.registerLanguage('xml', xml)

interface MarkdownRendererProps {
  content: string
  isStreaming?: boolean
  onOpenFileReference?: (reference: string) => void
}

type ComponentRenderer = (...args: never[]) => unknown
type HeadingRenderer = Extract<NonNullable<Components['h1']>, ComponentRenderer>
type AnchorRenderer = Extract<NonNullable<Components['a']>, ComponentRenderer>
type PreRenderer = Extract<NonNullable<Components['pre']>, ComponentRenderer>
type CodeRenderer = Extract<NonNullable<Components['code']>, ComponentRenderer>

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed
    }
  }, [code])

  return (
    <button
      type="button"
      className="md-code-block-copy"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
    </button>
  )
}

function FileReferenceLink({
  reference,
  label,
  onOpen,
}: {
  reference: string
  label: string
  onOpen?: (ref: string) => void
}) {
  const parsed = parseFileReference(reference)
  if (!parsed) return <code className="md-inline-code">{label}</code>

  return (
    <a
      href="#"
      className="md-file-link"
      onClick={e => {
        e.preventDefault()
        onOpen?.(parsed.raw)
      }}
    >
      <span className="md-file-link-name">{parsed.basename}</span>
      {parsed.lineLabel ? <span className="md-file-link-line">{parsed.lineLabel}</span> : null}
    </a>
  )
}

function buildHeadingRenderer(level: 1 | 2 | 3) {
  const Tag = `h${level}` as const
  const className = `md-h${level}`
  const Heading = ({ children, ...props }: Parameters<HeadingRenderer>[0]) => (
    <Tag className={className} {...props}>
      {children}
    </Tag>
  )
  return Heading
}

function buildAnchorRenderer(onOpenFileReference?: (reference: string) => void) {
  const Anchor = ({ href, children, ...props }: Parameters<AnchorRenderer>[0]) => {
    if (
      href &&
      !href.startsWith('http://') &&
      !href.startsWith('https://') &&
      !href.startsWith('mailto:')
    ) {
      const parsed = parseFileReference(href)
      if (parsed) {
        return (
          <a
            href="#"
            className="md-file-link"
            onClick={e => {
              e.preventDefault()
              onOpenFileReference?.(parsed.raw)
            }}
            {...props}
          >
            <span className="md-file-link-name">{parsed.basename}</span>
            {parsed.lineLabel ? (
              <span className="md-file-link-line">{parsed.lineLabel}</span>
            ) : null}
          </a>
        )
      }
    }

    return (
      <a href={href} className="md-link" rel="noopener noreferrer" target="_blank" {...props}>
        {children}
      </a>
    )
  }
  return Anchor
}

function buildCodeBlockRenderer() {
  const Pre = ({ children }: Parameters<PreRenderer>[0]) => {
    let codeText = ''
    let language = ''

    const child = Array.isArray(children) ? children[0] : children
    if (child && typeof child === 'object' && 'props' in child) {
      const codeProps = child.props as { children?: string; className?: string }
      codeText = typeof codeProps.children === 'string' ? codeProps.children : ''
      const match = codeProps.className?.match(/language-(\w+)/)
      language = match ? match[1]! : ''
    }

    return (
      <div className="md-code-block-wrap">
        <div className="md-code-block-header">
          <span>{language || 'text'}</span>
          <CodeBlockCopyButton code={codeText} />
        </div>
        <pre className="md-code-block">{children}</pre>
      </div>
    )
  }
  return Pre
}

function buildCodeRenderer(
  isStreaming: boolean,
  onOpenFileReference?: (reference: string) => void
) {
  const Code = ({ children, className, ...props }: Parameters<CodeRenderer>[0]) => {
    const match = className?.match(/language-(\w+)/)
    const language = match ? match[1]! : ''
    const codeString = String(children).replace(/\n$/, '')

    if (match) {
      if (isStreaming) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }

      return (
        <SyntaxHighlighter language={language} useInlineStyles={false} PreTag="div" CodeTag="code">
          {codeString}
        </SyntaxHighlighter>
      )
    }

    const ref = parseFileReference(codeString)
    if (ref) {
      return (
        <FileReferenceLink reference={codeString} label={codeString} onOpen={onOpenFileReference} />
      )
    }

    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    )
  }
  return Code
}

function buildComponents(
  isStreaming: boolean,
  onOpenFileReference?: (reference: string) => void
): Components {
  return {
    h1: buildHeadingRenderer(1),
    h2: buildHeadingRenderer(2),
    h3: buildHeadingRenderer(3),
    hr: props => <hr className="md-hr" {...props} />,
    a: buildAnchorRenderer(onOpenFileReference),
    pre: buildCodeBlockRenderer(),
    code: buildCodeRenderer(isStreaming, onOpenFileReference),
  }
}

const remarkPlugins = [remarkGfm]

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming = false,
  onOpenFileReference,
}: MarkdownRendererProps) {
  const components = useMemo(
    () => buildComponents(isStreaming, onOpenFileReference),
    [isStreaming, onOpenFileReference]
  )

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
      {content}
    </ReactMarkdown>
  )
})
