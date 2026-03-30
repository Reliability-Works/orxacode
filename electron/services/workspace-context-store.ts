import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  ContextSelectionTrace,
  WorkspaceContextFile,
  WorkspaceContextWriteInput,
} from '../../shared/ipc'

const CONTEXT_ROOT = 'workspace-context'
const CONTEXT_VERSION = 'v1'
const MAX_MATCHES = 8
const MAX_CONTEXT_CHARS = 5_000
const CONTEXT_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'help',
  'how',
  'in',
  'into',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'please',
  'the',
  'then',
  'this',
  'to',
  'use',
  'with',
  'you',
  'your',
])

type WorkspaceContextStoreOptions = {
  rootDir?: string
  now?: () => number
  createID?: () => string
}

type ParsedSection = {
  contextID: string
  filename: string
  title: string
  heading: string
  content: string
}

type ContextPromptBuildResult = {
  prompt: string
  trace: ContextSelectionTrace
}

type ScoredSection = {
  section: ParsedSection
  score: number
  matchedCount: number
  ratio: number
}

function normalizeWorkspace(workspace: string) {
  return workspace.replace(/\\/g, '/').trim()
}

function workspaceHash(workspace: string) {
  return createHash('sha256').update(normalizeWorkspace(workspace)).digest('hex').slice(0, 16)
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug.length > 0 ? slug : 'context'
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w\s/-]/g, ' ')
    .split(/\s+/)
    .map(item => item.trim())
    .filter(item => item.length >= 3 && !CONTEXT_STOPWORDS.has(item))
    .slice(0, 120)
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function parseSections(file: WorkspaceContextFile): ParsedSection[] {
  const sections: ParsedSection[] = []
  const lines = file.content.split(/\r?\n/)
  let heading = 'Overview'
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (!content) {
      buffer = []
      return
    }
    sections.push({
      contextID: file.id,
      filename: file.filename,
      title: file.title,
      heading,
      content,
    })
    buffer = []
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch) {
      flush()
      heading = headingMatch[1]!.trim()
      continue
    }
    buffer.push(line)
  }
  flush()
  if (sections.length === 0) {
    sections.push({
      contextID: file.id,
      filename: file.filename,
      title: file.title,
      heading: 'Overview',
      content: file.content.trim(),
    })
  }
  return sections
}

function scoreContextSection(
  section: ParsedSection,
  queryTokens: string[],
  queryPhrase: string
): ScoredSection {
  const filenameTokens = tokenize(section.filename)
  const titleTokens = tokenize(section.title)
  const headingTokens = tokenize(section.heading)
  const contentTokens = tokenize(section.content).slice(0, 180)
  let score = 0
  const matchedTokens = new Set<string>()
  for (const token of queryTokens) {
    if (filenameTokens.includes(token)) {
      score += 4
      matchedTokens.add(token)
    }
    if (titleTokens.includes(token)) {
      score += 3
      matchedTokens.add(token)
    }
    if (headingTokens.includes(token)) {
      score += 2
      matchedTokens.add(token)
    }
    if (contentTokens.includes(token)) {
      score += 1
      matchedTokens.add(token)
    }
  }
  if (queryPhrase.length > 8 && section.content.toLowerCase().includes(queryPhrase)) {
    score += 5
  }
  return {
    section,
    score,
    matchedCount: matchedTokens.size,
    ratio: queryTokens.length === 0 ? 0 : matchedTokens.size / queryTokens.length,
  }
}

function sortAndFilterScoredSections(
  sections: ParsedSection[],
  queryTokens: string[],
  queryPhrase: string
) {
  return sections
    .map(section => scoreContextSection(section, queryTokens, queryPhrase))
    .filter(item => {
      if (item.score <= 0) {
        return false
      }
      const minMatchedCount = queryTokens.length >= 8 ? 2 : 1
      const minRatio = queryTokens.length >= 10 ? 0.18 : queryTokens.length >= 6 ? 0.14 : 0.1
      const minScore = queryTokens.length >= 10 ? 4 : queryTokens.length >= 6 ? 3 : 1
      return item.matchedCount >= minMatchedCount && item.ratio >= minRatio && item.score >= minScore
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const fileDiff = a.section.filename.localeCompare(b.section.filename)
      if (fileDiff !== 0) return fileDiff
      return a.section.heading.localeCompare(b.section.heading)
    })
}

function buildContextPrompt(selected: Array<{ filename: string; heading: string; snippet: string }>) {
  if (selected.length === 0) {
    return ''
  }
  const blocks: string[] = []
  let charCount = 0
  for (const item of selected) {
    const block = [`[${item.filename} :: ${item.heading}]`, item.snippet].join('\n')
    if (charCount + block.length > MAX_CONTEXT_CHARS) {
      break
    }
    blocks.push(block)
    charCount += block.length
  }
  return ['Workspace context:', ...blocks].join('\n\n')
}

export class WorkspaceContextStore {
  private readonly rootDir: string

  private readonly now: () => number

  private readonly createID: () => string

  constructor(options: WorkspaceContextStoreOptions = {}) {
    this.rootDir =
      options.rootDir ?? path.join(app.getPath('userData'), CONTEXT_ROOT, CONTEXT_VERSION)
    this.now = options.now ?? (() => Date.now())
    this.createID = options.createID ?? (() => randomUUID())
  }

  async list(workspace: string): Promise<WorkspaceContextFile[]> {
    const dir = await this.workspaceDir(workspace)
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const files: WorkspaceContextFile[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }
      const id = entry.name.slice(0, -3)
      const item = await this.read(workspace, id).catch(() => undefined)
      if (item) {
        files.push(item)
      }
    }
    return files.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(workspace: string, id: string): Promise<WorkspaceContextFile> {
    const dir = await this.workspaceDir(workspace)
    const safe = this.safeContextID(id)
    const filePath = path.join(dir, `${safe}.md`)
    const content = await readFile(filePath, 'utf8')
    const info = await stat(filePath)
    const title = this.deriveTitle(safe, content)
    return {
      id: safe,
      workspace: normalizeWorkspace(workspace),
      filename: `${safe}.md`,
      path: filePath,
      title,
      content,
      createdAt: info.birthtimeMs || info.mtimeMs,
      updatedAt: info.mtimeMs,
    }
  }

  async write(input: WorkspaceContextWriteInput): Promise<WorkspaceContextFile> {
    const workspace = normalizeWorkspace(input.workspace)
    const dir = await this.workspaceDir(workspace)
    const hasID = typeof input.id === 'string' && input.id.trim().length > 0
    const requested = hasID
      ? input.id!.trim()
      : input.filename?.replace(/\.md$/i, '').trim() || input.title || 'context'
    const safe = this.safeContextID(requested)
    const filePath = path.join(dir, `${safe}.md`)
    const body = input.content.endsWith('\n') ? input.content : `${input.content}\n`
    await writeFile(filePath, body, 'utf8')
    const info = await stat(filePath)
    return {
      id: safe,
      workspace,
      filename: `${safe}.md`,
      path: filePath,
      title: this.deriveTitle(safe, body),
      content: body,
      createdAt: info.birthtimeMs || info.mtimeMs,
      updatedAt: info.mtimeMs,
    }
  }

  async delete(workspace: string, id: string): Promise<boolean> {
    const dir = await this.workspaceDir(workspace)
    const safe = this.safeContextID(id)
    await rm(path.join(dir, `${safe}.md`), { force: true })
    return true
  }

  async buildPromptContext(
    workspace: string,
    sessionID: string,
    query: string
  ): Promise<ContextPromptBuildResult> {
    const files = await this.list(workspace)
    const normalizedWorkspace = normalizeWorkspace(workspace)
    const queryTokens = unique(tokenize(query))
    const traceBase = {
      id: this.createID(),
      workspace: normalizedWorkspace,
      sessionID,
      query,
      mode: 'hybrid_lexical_v1' as const,
      createdAt: this.now(),
    }
    if (queryTokens.length === 0) {
      return {
        prompt: '',
        trace: {
          ...traceBase,
          selected: [],
        },
      }
    }
    const sections = files.flatMap(file => parseSections(file))
    const scored = sortAndFilterScoredSections(sections, queryTokens, query.trim().toLowerCase()).slice(
      0,
      MAX_MATCHES
    )

    const selected = scored.map(({ section, score }) => ({
      contextID: section.contextID,
      filename: section.filename,
      title: section.title,
      heading: section.heading,
      score,
      snippet: section.content.slice(0, 500),
    }))

    const trace: ContextSelectionTrace = {
      ...traceBase,
      selected,
    }

    if (selected.length === 0) {
      return {
        prompt: '',
        trace,
      }
    }
    return {
      prompt: buildContextPrompt(selected),
      trace,
    }
  }

  private async workspaceDir(workspace: string) {
    const normalized = normalizeWorkspace(workspace)
    const dir = path.join(this.rootDir, workspaceHash(normalized))
    await mkdir(dir, { recursive: true })
    return dir
  }

  private safeContextID(id: string) {
    return slugify(id)
  }

  private deriveTitle(id: string, content: string) {
    const firstHeading = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.startsWith('# '))
    if (firstHeading) {
      return firstHeading.replace(/^#\s+/, '').trim()
    }
    return id.replace(/-/g, ' ')
  }
}
