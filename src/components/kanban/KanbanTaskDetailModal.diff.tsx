import { FileCode, FileDiff, FileMinus, FilePlus, Plus, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import type {
  KanbanDiffFile,
  KanbanReviewComment,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
} from '@shared/ipc'

function fileStatusIcon(status: string) {
  switch (status) {
    case 'added':
      return <FilePlus size={13} aria-hidden="true" />
    case 'deleted':
      return <FileMinus size={13} aria-hidden="true" />
    case 'renamed':
      return <FileCode size={13} aria-hidden="true" />
    default:
      return <FileDiff size={13} aria-hidden="true" />
  }
}

type DiffLineCommentComposerProps = {
  commentBody: string
  onCommentBodyChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

function DiffLineCommentComposer({
  commentBody,
  onCommentBodyChange,
  onCancel,
  onSubmit,
}: DiffLineCommentComposerProps) {
  return (
    <div className="kanban-diff-inline-comment kanban-diff-inline-comment--input">
      <textarea
        rows={2}
        value={commentBody}
        onChange={e => onCommentBodyChange(e.target.value)}
        placeholder="Add a review comment…"
        autoFocus
      />
      <div className="kanban-diff-inline-comment-actions">
        <button type="button" className="kanban-filter-toggle" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="kanban-primary-btn" onClick={onSubmit}>
          Comment
        </button>
      </div>
    </div>
  )
}

type DiffLineRowProps = {
  line: {
    type: string
    oldLineNumber?: number | null
    newLineNumber?: number | null
    content: string
  }
  commentLine: number | null
  commentBody: string
  lineComments: KanbanReviewComment[] | undefined
  onOpenComment: (lineNum: number) => void
  onCommentBodyChange: (value: string) => void
  onCancelComment: () => void
  onSubmitComment: () => void
}

function DiffLineRow({
  line,
  commentLine,
  commentBody,
  lineComments,
  onOpenComment,
  onCommentBodyChange,
  onCancelComment,
  onSubmitComment,
}: DiffLineRowProps) {
  const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
  return (
    <div>
      <div className={`kanban-diff-line kanban-diff-line--${line.type}`}>
        <span className="kanban-diff-line-num">{line.oldLineNumber ?? ''}</span>
        <span className="kanban-diff-line-num">{line.newLineNumber ?? ''}</span>
        <button
          type="button"
          className="kanban-diff-line-comment-btn"
          onClick={e => {
            e.stopPropagation()
            onOpenComment(lineNum)
          }}
          title="Add review comment"
        >
          <Plus size={10} />
        </button>
        <span className="kanban-diff-line-content">{line.content}</span>
      </div>
      {lineComments?.map(comment => (
        <div key={comment.id} className="kanban-diff-inline-comment">
          <strong>{comment.body}</strong>
          <small>{new Date(comment.createdAt).toLocaleString()}</small>
        </div>
      ))}
      {commentLine === lineNum ? (
        <DiffLineCommentComposer
          commentBody={commentBody}
          onCommentBodyChange={onCommentBodyChange}
          onCancel={onCancelComment}
          onSubmit={onSubmitComment}
        />
      ) : null}
    </div>
  )
}

type DiffHunkViewerProps = {
  hunk: KanbanDiffFile['hunks'][number]
  commentsByLine: Map<number, KanbanReviewComment[]>
  commentLine: number | null
  commentBody: string
  onOpenComment: (lineNum: number) => void
  onCommentBodyChange: (value: string) => void
  onCancelComment: () => void
  onSubmitComment: () => void
}

function DiffHunkViewer({
  hunk,
  commentsByLine,
  commentLine,
  commentBody,
  onOpenComment,
  onCommentBodyChange,
  onCancelComment,
  onSubmitComment,
}: DiffHunkViewerProps) {
  return (
    <div className="kanban-diff-hunk">
      <div className="kanban-diff-hunk-header">{hunk.header}</div>
      {hunk.lines.map((line, lineIndex) => {
        const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
        const lineComments = commentsByLine.get(lineNum)
        return (
          <DiffLineRow
            key={lineIndex}
            line={line}
            commentLine={commentLine}
            commentBody={commentBody}
            lineComments={lineComments}
            onOpenComment={onOpenComment}
            onCommentBodyChange={onCommentBodyChange}
            onCancelComment={onCancelComment}
            onSubmitComment={onSubmitComment}
          />
        )
      })}
    </div>
  )
}

type DiffFileViewerProps = {
  file: KanbanDiffFile
  reviewComments: KanbanReviewComment[]
  onAddComment: (filePath: string, line: number, body: string) => void
}

function DiffFileViewer({ file, reviewComments, onAddComment }: DiffFileViewerProps) {
  const [commentLine, setCommentLine] = useState<number | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const filePath = file.newPath || file.oldPath
  const fileComments = reviewComments.filter(c => c.filePath === filePath)
  const commentsByLine = new Map<number, KanbanReviewComment[]>()
  for (const comment of fileComments) {
    const current = commentsByLine.get(comment.line) ?? []
    current.push(comment)
    commentsByLine.set(comment.line, current)
  }

  return (
    <div className="kanban-diff-file-viewer">
      <div className="kanban-diff-file-path">
        {fileStatusIcon(file.status)}
        <span>{file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : filePath}</span>
      </div>
      {file.hunks.map((hunk, hunkIndex) => (
        <DiffHunkViewer
          key={hunkIndex}
          hunk={hunk}
          commentsByLine={commentsByLine}
          commentLine={commentLine}
          commentBody={commentBody}
          onOpenComment={lineNum => {
            setCommentLine(commentLine === lineNum ? null : lineNum)
            setCommentBody('')
          }}
          onCommentBodyChange={setCommentBody}
          onCancelComment={() => setCommentLine(null)}
          onSubmitComment={() => {
            if (commentBody.trim()) {
              onAddComment(filePath, commentLine ?? 0, commentBody.trim())
              setCommentLine(null)
              setCommentBody('')
            }
          }}
        />
      ))}
    </div>
  )
}

type DiffViewerProps = {
  diffFiles: KanbanDiffFile[]
  selectedFileIndex: number
  reviewComments: KanbanReviewComment[]
  onSelectFile: (index: number) => void
  onAddComment: (filePath: string, line: number, body: string) => void
}

export function DiffViewer({
  diffFiles,
  selectedFileIndex,
  reviewComments,
  onSelectFile,
  onAddComment,
}: DiffViewerProps) {
  return (
    <div className="kanban-diff-viewer">
      {diffFiles.length > 0 ? (
        <>
          <div className="kanban-diff-file-list">
            {diffFiles.map((file, index) => (
              <button
                key={`${file.oldPath}-${file.newPath}`}
                type="button"
                className={`kanban-diff-file-item kanban-diff-file-item--${file.status}${index === selectedFileIndex ? ' active' : ''}`}
                onClick={() => onSelectFile(index)}
              >
                <span>{fileStatusIcon(file.status)}</span>
                <span>{file.newPath || file.oldPath}</span>
              </button>
            ))}
          </div>
          <div className="kanban-diff-hunk-view">
            {diffFiles[selectedFileIndex] ? (
              <DiffFileViewer
                file={diffFiles[selectedFileIndex]}
                reviewComments={reviewComments}
                onAddComment={onAddComment}
              />
            ) : null}
          </div>
        </>
      ) : (
        <div className="kanban-empty-state">No changes</div>
      )}
    </div>
  )
}

type ReviewTabProps = {
  feedbackDraft: string
  onFeedbackChange: (value: string) => void
  onSendFeedback: () => void
  reviewFilePath: string
  onReviewFilePathChange: (value: string) => void
  reviewLine: string
  onReviewLineChange: (value: string) => void
  reviewBody: string
  onReviewBodyChange: (value: string) => void
  onAddComment: () => void
  reviewComments: KanbanReviewComment[]
}

export function ReviewTab({
  feedbackDraft,
  onFeedbackChange,
  onSendFeedback,
  reviewFilePath,
  onReviewFilePathChange,
  reviewLine,
  onReviewLineChange,
  reviewBody,
  onReviewBodyChange,
  onAddComment,
  reviewComments,
}: ReviewTabProps) {
  return (
    <div className="kanban-detail-review">
      <section className="kanban-task-detail-section">
        <h3>Feedback</h3>
        <textarea
          rows={3}
          value={feedbackDraft}
          onChange={e => onFeedbackChange(e.target.value)}
          placeholder="Ask the task to revise or continue…"
        />
        <button type="button" className="kanban-filter-toggle" onClick={onSendFeedback}>
          <MessageSquare size={12} /> Send feedback
        </button>
      </section>

      <section className="kanban-task-detail-section">
        <h3>Add comment</h3>
        <div className="kanban-inline-row">
          <input
            value={reviewFilePath}
            onChange={e => onReviewFilePathChange(e.target.value)}
            placeholder="src/file.ts"
          />
          <input
            value={reviewLine}
            onChange={e => onReviewLineChange(e.target.value)}
            placeholder="line"
            style={{ width: 60 }}
          />
        </div>
        <textarea
          rows={2}
          value={reviewBody}
          onChange={e => onReviewBodyChange(e.target.value)}
          placeholder="Explain the issue…"
        />
        <button type="button" className="kanban-filter-toggle" onClick={onAddComment}>
          Add comment
        </button>
      </section>

      <section className="kanban-task-detail-section">
        <h3>Comments ({reviewComments.length})</h3>
        <div className="kanban-review-comment-list">
          {reviewComments.map(comment => (
            <article key={comment.id} className="kanban-list-card">
              <header className="kanban-list-card-header">
                <strong className="kanban-detail-mono">
                  {comment.filePath}:{comment.line}
                </strong>
                <small>{new Date(comment.createdAt).toLocaleString()}</small>
              </header>
              <p className="kanban-list-card-desc">{comment.body}</p>
            </article>
          ))}
          {reviewComments.length === 0 ? (
            <div className="kanban-empty-state">No comments yet</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

type CheckpointsListProps = {
  checkpoints: KanbanTaskCheckpoint[]
  selectedCheckpointId: string | null
  onSelectCheckpoint: (id: string) => void
}

export function CheckpointsList({
  checkpoints,
  selectedCheckpointId,
  onSelectCheckpoint,
}: CheckpointsListProps) {
  return (
    <div className="kanban-detail-checkpoints">
      <div className="kanban-checkpoint-list">
        {checkpoints.map(cp => (
          <button
            key={cp.id}
            type="button"
            className={`kanban-checkpoint-item${selectedCheckpointId === cp.id ? ' active' : ''}`}
            onClick={() => onSelectCheckpoint(cp.id)}
          >
            <div className="kanban-checkpoint-item-header">
              <strong>{cp.label || 'Checkpoint'}</strong>
              <span className="kanban-task-pill">{cp.source}</span>
            </div>
            <div className="kanban-checkpoint-item-meta">
              {cp.gitRevision ? (
                <span className="kanban-detail-mono">{cp.gitRevision.slice(0, 8)}</span>
              ) : null}
              <span>{new Date(cp.createdAt).toLocaleString()}</span>
            </div>
          </button>
        ))}
        {checkpoints.length === 0 ? (
          <div className="kanban-empty-state">No checkpoints yet</div>
        ) : null}
      </div>
    </div>
  )
}

export function TranscriptTab({ transcript }: { transcript: KanbanTaskDetail['transcript'] }) {
  return (
    <div className="kanban-transcript">
      {transcript.map(item => (
        <article key={item.id} className={`kanban-transcript-item is-${item.role}`.trim()}>
          <header>
            <strong>{item.role}</strong>
            <small>{new Date(item.timestamp).toLocaleString()}</small>
          </header>
          <pre>{item.content}</pre>
        </article>
      ))}
      {transcript.length === 0 ? (
        <div className="kanban-empty-state">No transcript entries</div>
      ) : null}
    </div>
  )
}
