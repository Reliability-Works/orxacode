import { useQuestionDockController } from './question-dock-controller'
import { QuestionDockView } from './question-dock-view'

export interface QuestionOption {
  label: string
  value: string
}

export interface AgentQuestion {
  id: string
  header?: string
  text: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

export interface QuestionDockProps {
  questions: AgentQuestion[]
  onSubmit: (answers: Record<string, string | string[]>) => void
  onReject: () => void
}

export function QuestionDock({ questions, onSubmit, onReject }: QuestionDockProps) {
  const controller = useQuestionDockController({ questions, onSubmit, onReject })
  if (!controller.question) {
    return null
  }
  return <QuestionDockView {...controller} />
}
