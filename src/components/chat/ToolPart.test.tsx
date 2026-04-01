import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToolPart } from './ToolPart'

describe('ToolPart basics', () => {
  it('routes bash to BashTool — renders command', () => {
    render(<ToolPart toolName="bash" status="completed" command="ls -la" output="total 0" />)
    expect(document.querySelector('.bash-tool')).toBeInTheDocument()
    const title = document.querySelector('.tool-call-card-title')
    expect(title?.textContent).toBe('ls -la')
  })

  it('routes shell to BashTool', () => {
    render(<ToolPart toolName="shell" status="completed" command="echo hi" />)
    expect(document.querySelector('.bash-tool')).toBeInTheDocument()
  })

  it('routes command to BashTool', () => {
    render(<ToolPart toolName="command" status="running" command="make build" />)
    expect(document.querySelector('.bash-tool')).toBeInTheDocument()
  })

  it('extracts command from input when command prop absent', () => {
    render(<ToolPart toolName="bash" status="completed" input={{ command: 'npm test' }} />)
    expect(screen.getByText('npm test')).toBeInTheDocument()
  })

  it('routes edit to EditTool', () => {
    render(
      <ToolPart
        toolName="edit"
        status="completed"
        input={{ path: 'src/app.ts', insertions: 2, deletions: 1 }}
      />
    )
    expect(document.querySelector('.edit-tool')).toBeInTheDocument()
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
  })

  it('routes write to EditTool', () => {
    render(<ToolPart toolName="write" status="completed" input={{ path: 'src/new.ts' }} />)
    expect(document.querySelector('.edit-tool')).toBeInTheDocument()
  })

  it('routes apply_patch with changes array to stacked EditTools', () => {
    render(
      <ToolPart
        toolName="apply_patch"
        status="completed"
        changes={[
          { path: 'a.ts', insertions: 1 },
          { path: 'b.ts', deletions: 2 },
        ]}
      />
    )
    expect(document.querySelectorAll('.edit-tool').length).toBe(2)
  })

  it('routes read to ContextToolGroup', () => {
    render(<ToolPart toolName="read" status="completed" input={{ path: 'src/utils.ts' }} />)
    expect(document.querySelector('.context-tool-group')).toBeInTheDocument()
    expect(screen.getByText('src/utils.ts')).toBeInTheDocument()
  })

  it('routes glob to ContextToolGroup', () => {
    render(<ToolPart toolName="glob" status="completed" input={{ pattern: '**/*.ts' }} />)
    expect(document.querySelector('.context-tool-group')).toBeInTheDocument()
  })

  it('routes grep to ContextToolGroup', () => {
    render(<ToolPart toolName="grep" status="completed" input={{ pattern: 'useState' }} />)
    expect(document.querySelector('.context-tool-group')).toBeInTheDocument()
  })

  it('routes webfetch to ContextToolGroup', () => {
    render(
      <ToolPart toolName="webfetch" status="completed" input={{ url: 'https://example.com' }} />
    )
    expect(document.querySelector('.context-tool-group')).toBeInTheDocument()
  })
})

describe('ToolPart special cases', () => {
  it('routes todowrite to checklist', () => {
    render(
      <ToolPart
        toolName="todowrite"
        status="completed"
        input={{
          todos: [
            { content: 'Task one', status: 'completed' },
            { content: 'Task two', status: 'pending' },
          ],
        }}
      />
    )
    expect(document.querySelector('.todo-checklist')).toBeInTheDocument()
    expect(screen.getByText('Task one')).toBeInTheDocument()
    expect(screen.getByText('Task two')).toBeInTheDocument()
  })

  it('todowrite marks completed items with checkmark', () => {
    render(
      <ToolPart
        toolName="todowrite"
        status="completed"
        input={{ todos: [{ content: 'Done item', status: 'completed' }] }}
      />
    )
    expect(document.querySelector('.todo-checklist-item--done')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('routes question to inline question display', () => {
    render(
      <ToolPart
        toolName="question"
        status="completed"
        input={{ question: 'What is the meaning of life?' }}
      />
    )
    expect(document.querySelector('.question-display')).toBeInTheDocument()
    expect(screen.getByText('What is the meaning of life?')).toBeInTheDocument()
  })

  it('routes task to task card', () => {
    render(<ToolPart toolName="task" status="completed" input={{ description: 'Build the UI' }} />)
    expect(document.querySelector('.task-card')).toBeInTheDocument()
    expect(screen.getByText('Build the UI')).toBeInTheDocument()
  })

  it('falls back to generic ToolCallCard for unknown tool', () => {
    render(
      <ToolPart
        toolName="mystery"
        status="completed"
        title="Unknown action"
        output="done"
      />
    )
    expect(document.querySelector('.tool-call-card')).toBeInTheDocument()
    expect(screen.getByText('Unknown action')).toBeInTheDocument()
  })
})
