import type { KanbanDiffFile, KanbanDiffHunk, KanbanDiffLine } from '../../shared/ipc'

function finalizeFile(files: KanbanDiffFile[], currentFile: KanbanDiffFile | null) {
  if (currentFile) {
    files.push(currentFile)
  }
}

export function parseUnifiedDiff(raw: string): KanbanDiffFile[] {
  const lines = raw.split(/\r?\n/)
  const files: KanbanDiffFile[] = []
  let currentFile: KanbanDiffFile | null = null
  let currentHunk: KanbanDiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = {
        oldPath: '',
        newPath: '',
        status: 'modified',
        hunks: [],
      }
    }
    return currentFile
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finalizeFile(files, currentFile)
      currentFile = {
        oldPath: '',
        newPath: '',
        status: 'modified',
        hunks: [],
      }
      currentHunk = null
      continue
    }
    if (line.startsWith('--- ')) {
      ensureFile().oldPath = line.slice(4).replace(/^a\//, '')
      continue
    }
    if (line.startsWith('+++ ')) {
      ensureFile().newPath = line.slice(4).replace(/^b\//, '')
      continue
    }
    if (line.startsWith('new file mode')) {
      ensureFile().status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      ensureFile().status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      ensureFile().status = 'renamed'
      ensureFile().oldPath = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ')) {
      ensureFile().status = 'renamed'
      ensureFile().newPath = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLine = match ? Number(match[1]) : 0
      newLine = match ? Number(match[2]) : 0
      currentHunk = { header: line, lines: [] }
      ensureFile().hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) {
      continue
    }
    let parsedLine: KanbanDiffLine
    if (line.startsWith('+')) {
      parsedLine = { type: 'add', content: line.slice(1), newLineNumber: newLine }
      newLine += 1
    } else if (line.startsWith('-')) {
      parsedLine = { type: 'del', content: line.slice(1), oldLineNumber: oldLine }
      oldLine += 1
    } else {
      parsedLine = {
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLineNumber: oldLine || undefined,
        newLineNumber: newLine || undefined,
      }
      if (!line.startsWith('\\')) {
        oldLine += 1
        newLine += 1
      }
    }
    currentHunk.lines.push(parsedLine)
  }

  finalizeFile(files, currentFile)
  return files.filter(file => file.oldPath || file.newPath || file.hunks.length > 0)
}
