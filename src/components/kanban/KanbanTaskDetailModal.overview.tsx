import type {
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanScriptShortcutResult,
  KanbanTask,
  KanbanTaskDetail,
  KanbanTaskProviderConfig,
} from '@shared/ipc'
import {
  OverviewActions,
  type OverviewActionsProps,
} from './KanbanTaskDetailModal.actions-bar'
import { providerLabel } from './kanban-utils'
import { KanbanTaskProviderConfigFields } from './KanbanTaskProviderConfigFields'

function RuntimeSection({ runtime }: { runtime: KanbanTaskDetail['runtime'] }) {
  if (!runtime) return null

  return (
    <section className="kanban-task-detail-section">
      <h3>Runtime</h3>
      <div className="kanban-detail-runtime-grid">
        <span>Status</span>
        <span>{runtime.status}</span>
        <span>Provider</span>
        <span>{providerLabel(runtime.provider)}</span>
        {runtime.worktreePath ? (
          <>
            <span>Worktree</span>
            <span className="kanban-detail-mono">{runtime.worktreePath}</span>
          </>
        ) : null}
        {runtime.taskBranch ? (
          <>
            <span>Branch</span>
            <span className="kanban-detail-mono">{runtime.taskBranch}</span>
          </>
        ) : null}
        {runtime.lastEventSummary ? (
          <>
            <span>Last event</span>
            <span>{runtime.lastEventSummary}</span>
          </>
        ) : null}
        {runtime.latestPreview ? (
          <>
            <span>Latest preview</span>
            <span>{runtime.latestPreview}</span>
          </>
        ) : null}
        {runtime.mergeStatus ? (
          <>
            <span>Merge status</span>
            <span>{runtime.mergeStatus}</span>
          </>
        ) : null}
      </div>
    </section>
  )
}

function ShortcutOutputSection({
  shortcutResult,
}: {
  shortcutResult: KanbanScriptShortcutResult | null
}) {
  if (!shortcutResult) return null

  return (
    <section className="kanban-task-detail-section">
      <h3>Shortcut output</h3>
      <pre className="kanban-diff-preview">
        {shortcutResult.output ||
          (shortcutResult.ok ? 'Completed successfully' : 'Command failed')}
      </pre>
    </section>
  )
}

type EditableFieldSectionProps = {
  title: string
  value: string
  isMultiline?: boolean
  rows?: number
  placeholder?: string
  regenerating: boolean
  onChange: (value: string) => void
  onRegenerate: () => void
}

function EditableFieldSection({
  title,
  value,
  isMultiline,
  rows,
  placeholder,
  regenerating,
  onChange,
  onRegenerate,
}: EditableFieldSectionProps) {
  const Input = isMultiline ? 'textarea' : 'input'
  const inputProps = isMultiline ? { rows: rows ?? 3 } : {}

  return (
    <section className="kanban-task-detail-section">
      <h3>{title}</h3>
      <Input
        {...inputProps}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={isMultiline ? undefined : 'kanban-edit-input'}
      />
      <button
        type="button"
        className="kanban-inline-meta-btn"
        disabled={regenerating}
        onClick={onRegenerate}
      >
        {regenerating ? 'Regenerating...' : 'Regenerate with AI'}
      </button>
    </section>
  )
}

type OverviewEditFieldsProps = {
  editing: boolean
  editTitle: string
  editDescription: string
  editPrompt: string
  regeneratingField: KanbanRegenerateTaskField | null
  task: KanbanTask
  onEditTitleChange: (value: string) => void
  onEditDescriptionChange: (value: string) => void
  onEditPromptChange: (value: string) => void
  onRegenerateField: (field: KanbanRegenerateTaskField) => void
}

function OverviewEditFields({
  editing,
  editTitle,
  editDescription,
  editPrompt,
  regeneratingField,
  task,
  onEditTitleChange,
  onEditDescriptionChange,
  onEditPromptChange,
  onRegenerateField,
}: OverviewEditFieldsProps) {
  return (
    <>
      {editing ? (
        <EditableFieldSection
          title="Title"
          value={editTitle}
          regenerating={regeneratingField === 'title'}
          onChange={onEditTitleChange}
          onRegenerate={() => void onRegenerateField('title')}
        />
      ) : null}
      {editing ? (
        <EditableFieldSection
          title="Description"
          value={editDescription}
          isMultiline
          rows={3}
          placeholder="Task description…"
          regenerating={regeneratingField === 'description'}
          onChange={onEditDescriptionChange}
          onRegenerate={() => void onRegenerateField('description')}
        />
      ) : task.description ? (
        <section className="kanban-task-detail-section">
          <h3>Description</h3>
          <p className="kanban-detail-text">{task.description}</p>
        </section>
      ) : null}
      {editing ? (
        <EditableFieldSection
          title="Prompt"
          value={editPrompt}
          isMultiline
          rows={5}
          regenerating={regeneratingField === 'prompt'}
          onChange={onEditPromptChange}
          onRegenerate={() => void onRegenerateField('prompt')}
        />
      ) : (
        <section className="kanban-task-detail-section">
          <h3>Prompt</h3>
          <pre className="kanban-diff-preview">{task.prompt}</pre>
        </section>
      )}
    </>
  )
}

type ProviderConfigSectionProps = {
  editing: boolean
  editProvider: KanbanProvider
  editProviderConfig: KanbanTaskProviderConfig | undefined
  workspaceDir: string
  onEditProviderChange: (value: KanbanProvider) => void
  onEditProviderConfigChange: (value: KanbanTaskProviderConfig | undefined) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
}

function ProviderConfigSection({
  editing,
  editProvider,
  editProviderConfig,
  workspaceDir,
  onEditProviderChange,
  onEditProviderConfigChange,
  onCancelEdit,
  onSaveEdit,
}: ProviderConfigSectionProps) {
  if (!editing) return null

  return (
    <section className="kanban-task-detail-section">
      <h3>Provider config</h3>
      <label className="kanban-field">
        <span>Provider</span>
        <div className="kanban-segmented-control">
          {(['opencode', 'codex', 'claude'] as const).map(provider => (
            <button
              key={provider}
              type="button"
              className={editProvider === provider ? 'active' : ''}
              onClick={() => onEditProviderChange(provider)}
            >
              {providerLabel(provider)}
            </button>
          ))}
        </div>
      </label>
      <KanbanTaskProviderConfigFields
        workspaceDir={workspaceDir}
        provider={editProvider}
        providerConfig={editProviderConfig}
        onChange={onEditProviderConfigChange}
      />
      <div className="kanban-task-detail-actions" style={{ paddingTop: 4 }}>
        <button type="button" className="kanban-filter-toggle" onClick={onCancelEdit}>
          Cancel
        </button>
        <button type="button" className="kanban-primary-btn" onClick={onSaveEdit}>
          Save changes
        </button>
      </div>
    </section>
  )
}

function DependenciesSection({
  dependencyTitles,
}: {
  dependencyTitles: Array<{ id: string; title: string }>
}) {
  if (dependencyTitles.length === 0) return null

  return (
    <section className="kanban-task-detail-section">
      <h3>Depends on</h3>
      <div className="kanban-dependency-list">
        {dependencyTitles.map(dep => (
          <span key={dep.id} className="kanban-task-pill">
            {dep.title}
          </span>
        ))}
      </div>
    </section>
  )
}

export type OverviewTabProps = {
  overviewProps: OverviewActionsProps
  runtime: KanbanTaskDetail['runtime']
  shortcutResult: KanbanScriptShortcutResult | null
  actionError: string | null
  editing: boolean
  editTitle: string
  editDescription: string
  editPrompt: string
  editProvider: KanbanProvider
  editProviderConfig: KanbanTaskProviderConfig | undefined
  regeneratingField: KanbanRegenerateTaskField | null
  task: KanbanTask
  dependencyTitles: Array<{ id: string; title: string }>
  onEditTitleChange: (value: string) => void
  onEditDescriptionChange: (value: string) => void
  onEditPromptChange: (value: string) => void
  onEditProviderChange: (value: KanbanProvider) => void
  onEditProviderConfigChange: (value: KanbanTaskProviderConfig | undefined) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onRegenerateField: (field: KanbanRegenerateTaskField) => void
  workspaceDir: string
}

export function OverviewTab({
  overviewProps,
  runtime,
  shortcutResult,
  actionError,
  editing,
  editTitle,
  editDescription,
  editPrompt,
  editProvider,
  editProviderConfig,
  regeneratingField,
  task,
  dependencyTitles,
  onEditTitleChange,
  onEditDescriptionChange,
  onEditPromptChange,
  onEditProviderChange,
  onEditProviderConfigChange,
  onCancelEdit,
  onSaveEdit,
  onRegenerateField,
  workspaceDir,
}: OverviewTabProps) {
  return (
    <div className="kanban-detail-overview">
      <OverviewActions {...overviewProps} />
      <RuntimeSection runtime={runtime} />
      <ShortcutOutputSection shortcutResult={shortcutResult} />
      {actionError ? (
        <section className="kanban-task-detail-section">
          <p className="skills-error">{actionError}</p>
        </section>
      ) : null}
      <OverviewEditFields
        editing={editing}
        editTitle={editTitle}
        editDescription={editDescription}
        editPrompt={editPrompt}
        regeneratingField={regeneratingField}
        task={task}
        onEditTitleChange={onEditTitleChange}
        onEditDescriptionChange={onEditDescriptionChange}
        onEditPromptChange={onEditPromptChange}
        onRegenerateField={onRegenerateField}
      />
      <ProviderConfigSection
        editing={editing}
        editProvider={editProvider}
        editProviderConfig={editProviderConfig}
        workspaceDir={workspaceDir}
        onEditProviderChange={onEditProviderChange}
        onEditProviderConfigChange={onEditProviderConfigChange}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
      />
      <DependenciesSection dependencyTitles={dependencyTitles} />
    </div>
  )
}
