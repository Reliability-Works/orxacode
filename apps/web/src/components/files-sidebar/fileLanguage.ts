import languageAssociationsData from '../../vscode-icons-language-associations.json'
import { basenameOfPath, extensionCandidates } from '../../pathValue'

interface LanguageAssociations {
  version: string
  extensionToLanguageId: Record<string, string>
  fileNameToLanguageId: Record<string, string>
}

const languageAssociations = languageAssociationsData as LanguageAssociations

const MONACO_LANGUAGE_OVERRIDES: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  clojure: 'clojure',
  coffeescript: 'coffeescript',
  cpp: 'cpp',
  csharp: 'csharp',
  css: 'css',
  dockerfile: 'dockerfile',
  fsharp: 'fsharp',
  go: 'go',
  graphql: 'graphql',
  handlebars: 'handlebars',
  hbs: 'handlebars',
  html: 'html',
  ini: 'ini',
  java: 'java',
  javascript: 'javascript',
  json: 'json',
  jsonc: 'json',
  julia: 'julia',
  kotlin: 'kotlin',
  less: 'less',
  lua: 'lua',
  markdown: 'markdown',
  objectivec: 'objective-c',
  perl: 'perl',
  php: 'php',
  plaintext: 'plaintext',
  powershell: 'powershell',
  python: 'python',
  r: 'r',
  razor: 'razor',
  ruby: 'ruby',
  rust: 'rust',
  scss: 'scss',
  shellscript: 'shell',
  sql: 'sql',
  swift: 'swift',
  typescript: 'typescript',
  vb: 'vb',
  xml: 'xml',
  yaml: 'yaml',
}

function resolveVscodeLanguageId(pathValue: string): string | null {
  const basename = basenameOfPath(pathValue).toLowerCase()
  const byFileName = languageAssociations.fileNameToLanguageId[basename]
  if (byFileName) return byFileName
  for (const candidate of extensionCandidates(basename)) {
    const byExtension = languageAssociations.extensionToLanguageId[candidate]
    if (byExtension) return byExtension
  }
  return null
}

export function resolveFileEditorLanguage(pathValue: string): string {
  const vscodeLanguageId = resolveVscodeLanguageId(pathValue)
  if (!vscodeLanguageId) return 'plaintext'
  return MONACO_LANGUAGE_OVERRIDES[vscodeLanguageId] ?? 'plaintext'
}
