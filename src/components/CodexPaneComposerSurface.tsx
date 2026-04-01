import { InteractionCard } from './chat/InteractionCard'
import type { CodexUsageAlert } from './CodexPane.helpers'
import { CodexPaneComposerPanel, type CodexPaneComposerPanelProps } from './CodexPaneComposerPanel'

type CodexPaneComposerSurfaceProps = {
  codexUsageAlert: CodexUsageAlert | null
  questionDockProps:
    | {
        questions: Array<{ id: string; text: string; options?: Array<{ value?: string; label: string }> }>
        onSubmit: (answers: Record<string, string | string[]>) => void
        onReject: () => void
      }
    | null
  pendingPlanProps:
    | {
        onAccept: () => void
        onSubmitChanges: (changes: string) => void
      onDismiss: () => void
    }
    | null
  composerProps: CodexPaneComposerPanelProps
}

export function CodexPaneComposerSurface({
  codexUsageAlert,
  questionDockProps,
  pendingPlanProps,
  composerProps,
}: CodexPaneComposerSurfaceProps) {
  return (
    <div className="codex-composer-area">
      <div className="center-pane-rail center-pane-rail--composer">
        {codexUsageAlert ? (
          <div className="codex-session-alert" role="alert">
            <strong>{codexUsageAlert.title}</strong>
            <span>{codexUsageAlert.body}</span>
          </div>
        ) : null}
        {questionDockProps ? (
          <InteractionCard
            title={questionDockProps.questions[0]?.text ?? 'The agent is requesting your input.'}
            options={[
              ...(questionDockProps.questions[0]?.options?.map((o, i) => ({
                id: o.value ?? `opt-${i}`,
                label: o.label,
              })) ?? []),
              {
                id: 'custom',
                label: 'No, and tell Codex what to do differently',
                isCustomInput: true,
              },
            ]}
            onSubmit={(optionId, customText) => {
              if (optionId === 'custom' && customText) {
                questionDockProps.onSubmit({
                  [questionDockProps.questions[0]?.id ?? 'q']: customText,
                })
              } else {
                questionDockProps.onSubmit({
                  [questionDockProps.questions[0]?.id ?? 'q']: optionId,
                })
              }
            }}
            onDismiss={questionDockProps.onReject}
          />
        ) : pendingPlanProps ? (
          <InteractionCard
            title="Implement this plan?"
            options={[
              { id: 'accept', label: 'Yes, implement this plan' },
              {
                id: 'change',
                label: 'No, and tell Codex what to do differently',
                isCustomInput: true,
              },
            ]}
            onSubmit={(optionId, customText) => {
              if (optionId === 'accept') {
                pendingPlanProps.onAccept()
              } else if (customText) {
                pendingPlanProps.onSubmitChanges(customText)
              }
            }}
            onDismiss={pendingPlanProps.onDismiss}
          />
        ) : (
          <CodexPaneComposerPanel {...composerProps} />
        )}
      </div>
    </div>
  )
}
