import type { AgentsDocument } from '@shared/ipc'

type PersonalizationSectionProps = {
  globalAgentsDoc: AgentsDocument | null
  globalAgentsText: string
  setGlobalAgentsText: (value: string) => void
  onWriteGlobalAgentsMd: (content: string) => Promise<AgentsDocument>
  onReadGlobalAgentsMd: () => Promise<AgentsDocument>
  setGlobalAgentsDoc: (doc: AgentsDocument) => void
  setFeedback: (message: string) => void
}

export function PersonalizationSection({
  globalAgentsDoc,
  globalAgentsText,
  setGlobalAgentsText,
  onWriteGlobalAgentsMd,
  onReadGlobalAgentsMd,
  setGlobalAgentsDoc,
  setFeedback,
}: PersonalizationSectionProps) {
  return (
    <section className="settings-section-card settings-pad">
      <p className="settings-personalization-desc">
        your global AGENTS.md which will apply to all workspace sessions.
      </p>
      <p className="settings-personalization-path">
        {globalAgentsDoc?.path ?? '~/.config/opencode/AGENTS.md'}
      </p>
      <label htmlFor="global-agents-textarea" className="settings-personalization-field-label">
        global AGENTS.md
      </label>
      <textarea
        id="global-agents-textarea"
        className="settings-personalization-textarea"
        value={globalAgentsText}
        placeholder="Add personal agent rules for all workspaces..."
        onChange={event => setGlobalAgentsText(event.target.value)}
      />
      <div className="settings-personalization-actions">
        <button
          type="button"
          className="settings-personalization-save-btn"
          onClick={() =>
            void onWriteGlobalAgentsMd(globalAgentsText)
              .then(doc => {
                setGlobalAgentsDoc(doc)
                setGlobalAgentsText(doc.content)
                setFeedback('Global AGENTS.md saved')
              })
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }
        >
          save
        </button>
        <button
          type="button"
          className="settings-personalization-reload-btn"
          onClick={() =>
            void onReadGlobalAgentsMd()
              .then(doc => {
                setGlobalAgentsDoc(doc)
                setGlobalAgentsText(doc.content)
                setFeedback('Global AGENTS.md reloaded')
              })
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }
        >
          reload
        </button>
      </div>
    </section>
  )
}
