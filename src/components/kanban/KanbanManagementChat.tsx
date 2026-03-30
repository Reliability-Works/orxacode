import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, Send, User, X } from 'lucide-react'
import type {
  KanbanManagementPromptResult,
  KanbanManagementSession,
  KanbanProvider,
} from '@shared/ipc'
import { providerLabel } from './kanban-utils'

type Props = {
  workspaceDir: string
}

function OperationsSummary({ result }: { result: KanbanManagementPromptResult }) {
  if (result.operations.length === 0) return null
  return (
    <div className="kanban-mgmt-ops">
      <h4>Operations applied</h4>
      {result.applied.map((item, index) => (
        <div key={index} className={`kanban-mgmt-op${item.ok ? ' is-ok' : ' is-error'}`}>
          {item.ok ? <Check size={12} /> : <X size={12} />}
          <span>{item.type.replace(/_/g, ' ')}</span>
          {item.error ? <span className="kanban-mgmt-op-error">{item.error}</span> : null}
        </div>
      ))}
    </div>
  )
}

function ManagementTranscript({
  transcript,
  lastResult,
}: {
  transcript: KanbanManagementSession['transcript']
  lastResult: KanbanManagementPromptResult | null
}) {
  return (
    <>
      {transcript.map(item => (
        <div
          key={item.id}
          className={`kanban-management-message kanban-management-message--${item.role}`}
        >
          <div className="kanban-management-message-icon">
            {item.role === 'user' ? (
              <User size={12} />
            ) : item.role === 'assistant' ? (
              <Bot size={12} />
            ) : null}
          </div>
          <div className="kanban-management-message-body">
            <pre>{item.content}</pre>
            <small>{new Date(item.timestamp).toLocaleTimeString()}</small>
          </div>
        </div>
      ))}
      {transcript.length === 0 ? (
        <div className="kanban-empty-state">
          Send a prompt to manage your board. Try &quot;Break down this feature into tasks&quot;
          or &quot;Create a task to fix the login bug&quot;.
        </div>
      ) : null}
      {lastResult ? <OperationsSummary result={lastResult} /> : null}
    </>
  )
}

function ProviderSelector({
  provider,
  onChange,
  session,
}: {
  provider: KanbanProvider
  onChange: (p: KanbanProvider) => void
  session: KanbanManagementSession | null
}) {
  return (
    <div className="kanban-management-header">
      <div className="kanban-segmented-control">
        {(['opencode', 'codex', 'claude'] as const).map(p => (
          <button
            key={p}
            type="button"
            className={provider === p ? 'active' : ''}
            onClick={() => onChange(p)}
          >
            {providerLabel(p)}
          </button>
        ))}
      </div>
      {session ? <span className="kanban-task-pill">{session.status}</span> : null}
    </div>
  )
}

function ManagementInput({
  prompt,
  sending,
  onChange,
  onSend,
}: {
  prompt: string
  sending: boolean
  onChange: (value: string) => void
  onSend: () => void
}) {
  return (
    <div className="kanban-management-input">
      <textarea
        rows={2}
        value={prompt}
        onChange={e => onChange(e.target.value)}
        placeholder="Describe what you want to do on the board…"
        disabled={sending}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void onSend()
          }
        }}
      />
      <button
        type="button"
        className="kanban-primary-btn"
        disabled={sending || !prompt.trim()}
        onClick={() => void onSend()}
      >
        <Send size={13} />
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}

export function KanbanManagementChat({ workspaceDir }: Props) {
  const [provider, setProvider] = useState<KanbanProvider>('opencode')
  const [session, setSession] = useState<KanbanManagementSession | null>(null)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [lastResult, setLastResult] = useState<KanbanManagementPromptResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const initSession = useCallback(
    async (p: KanbanProvider) => {
      setError(null)
      try {
        const existing = await window.orxa.kanban.getManagementSession(workspaceDir, p)
        if (existing) {
          setSession(existing)
          return
        }
        const next = await window.orxa.kanban.startManagementSession(workspaceDir, p)
        setSession(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [workspaceDir]
  )

  useEffect(() => {
    void initSession(provider)
  }, [initSession, provider])

  useEffect(() => {
    const unsubscribe = window.orxa.events.subscribe(event => {
      if (event.type === 'kanban.management') {
        const payload = event.payload as { workspaceDir: string; session: KanbanManagementSession }
        if (payload.workspaceDir === workspaceDir) {
          setSession(payload.session)
        }
      }
    })
    return unsubscribe
  }, [workspaceDir])

  const transcriptLength = session?.transcript.length ?? 0
  const prevTranscriptLength = useRef(0)

  useEffect(() => {
    if (transcriptLength > prevTranscriptLength.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      })
    }
    prevTranscriptLength.current = transcriptLength
  }, [transcriptLength])

  const handleSend = useCallback(async () => {
    const text = prompt.trim()
    if (!text || sending) return
    setSending(true)
    setLastResult(null)
    try {
      const result = await window.orxa.kanban.sendManagementPrompt(workspaceDir, provider, text)
      setSession(result.session)
      setLastResult(result)
      setPrompt('')
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSending(false)
  }, [prompt, sending, workspaceDir, provider])

  const handleProviderChange = useCallback(
    (p: KanbanProvider) => {
      setProvider(p)
      setLastResult(null)
    },
    [setProvider, setLastResult]
  )

  const transcript = session?.transcript ?? []

  return (
    <section className="kanban-management">
      <ProviderSelector
        provider={provider}
        onChange={handleProviderChange}
        session={session}
      />

      {error ? (
        <p className="skills-error" style={{ padding: '0 0 8px' }}>
          {error}
        </p>
      ) : null}

      <div className="kanban-management-transcript" ref={scrollRef}>
        <ManagementTranscript transcript={transcript} lastResult={lastResult} />
      </div>

      <ManagementInput prompt={prompt} sending={sending} onChange={setPrompt} onSend={handleSend} />
    </section>
  )
}
