import {
  useCallback,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import { Zap } from 'lucide-react'
import { CanvasTileComponent } from '../CanvasTile'
import type { CanvasTileComponentProps } from './tile-shared'

type ApiTesterTileProps = CanvasTileComponentProps

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

function getMethodColor(method: HttpMethod): string {
  switch (method) {
    case 'GET':
      return '#22C55E'
    case 'POST':
      return '#3B82F6'
    case 'PUT':
      return '#F59E0B'
    case 'DELETE':
      return '#EF4444'
    case 'PATCH':
      return '#A78BFA'
  }
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return '#22C55E'
  if (status >= 400) return '#EF4444'
  return 'var(--text-secondary)'
}

export function ApiTesterTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: ApiTesterTileProps) {
  const [method, setMethod] = useState<HttpMethod>((tile.meta.method as HttpMethod) ?? 'GET')
  const [url, setUrl] = useState<string>(typeof tile.meta.url === 'string' ? tile.meta.url : '')
  const [headers, setHeaders] = useState<string>(
    typeof tile.meta.headers === 'string' ? tile.meta.headers : ''
  )
  const [body, setBody] = useState<string>(typeof tile.meta.body === 'string' ? tile.meta.body : '')
  const { handleSend, isSending, responseBody, responseStatus, responseTime } =
    useApiTesterResponse({ body, headers, method, url })

  const metaLabel = url ? `${method} ${url}` : method

  const syncMeta = useCallback(
    (updates: Partial<{ method: HttpMethod; url: string }>) => {
      onUpdate(tile.id, {
        meta: {
          ...tile.meta,
          method: updates.method ?? method,
          url: updates.url ?? url,
        },
      })
    },
    [tile.id, tile.meta, method, url, onUpdate]
  )

  const handleMethodChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const m = e.target.value as HttpMethod
      setMethod(m)
      syncMeta({ method: m })
    },
    [syncMeta]
  )

  const handleUrlChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const u = e.target.value
      setUrl(u)
      syncMeta({ url: u })
    },
    [syncMeta]
  )

  const handleSendKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleSend()
      }
    },
    [handleSend]
  )

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<Zap size={12} />}
      label="api tester"
      iconColor="var(--text-tertiary, #737373)"
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="api-tester-tile-body">
        <ApiTesterRequestBuilder
          body={body}
          handleMethodChange={handleMethodChange}
          handleSend={handleSend}
          handleSendKeyDown={handleSendKeyDown}
          handleUrlChange={handleUrlChange}
          headers={headers}
          isSending={isSending}
          method={method}
          setBody={setBody}
          setHeaders={setHeaders}
          url={url}
        />
        <ApiTesterResponsePanel
          isSending={isSending}
          responseBody={responseBody}
          responseStatus={responseStatus}
          responseTime={responseTime}
        />
      </div>
    </CanvasTileComponent>
  )
}

function useApiTesterResponse({
  body,
  headers,
  method,
  url,
}: {
  body: string
  headers: string
  method: HttpMethod
  url: string
}) {
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const [responseBody, setResponseBody] = useState<string>('')
  const [isSending, setIsSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!url.trim()) return
    setIsSending(true)
    setResponseStatus(null)
    setResponseTime(null)
    setResponseBody('')

    const parsedHeaders = parseHeaders(headers)
    const bridge = typeof window !== 'undefined' ? window.orxa?.app : undefined

    const result = bridge?.httpRequest
      ? await sendBridgeRequest({ body, bridge, method, parsedHeaders, url })
      : await sendRendererRequest({ body, method, parsedHeaders, url })

    setResponseStatus(result.status)
    setResponseTime(result.elapsed)
    setResponseBody(result.body)
    setIsSending(false)
  }, [body, headers, method, url])

  return { handleSend, isSending, responseBody, responseStatus, responseTime }
}

function parseHeaders(headers: string) {
  const parsedHeaders: Record<string, string> = {}
  for (const line of headers.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > -1) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (key) parsedHeaders[key] = value
    }
  }
  return parsedHeaders
}

async function sendBridgeRequest({
  body,
  bridge,
  method,
  parsedHeaders,
  url,
}: {
  body: string
  bridge: NonNullable<typeof window.orxa.app>
  method: HttpMethod
  parsedHeaders: Record<string, string>
  url: string
}) {
  try {
    return await bridge.httpRequest({
      method,
      url,
      headers: parsedHeaders,
      body: method !== 'GET' && method !== 'DELETE' && body.trim() ? body : undefined,
    })
  } catch (err) {
    return {
      status: 0,
      elapsed: 0,
      body: err instanceof Error ? err.message : String(err),
    }
  }
}

async function sendRendererRequest({
  body,
  method,
  parsedHeaders,
  url,
}: {
  body: string
  method: HttpMethod
  parsedHeaders: Record<string, string>
  url: string
}) {
  const start = performance.now()
  try {
    const init: RequestInit = { method, headers: parsedHeaders }
    if (method !== 'GET' && method !== 'DELETE' && body.trim()) {
      init.body = body
    }
    const response = await fetch(url, init)
    const text = await response.text()
    return {
      status: response.status,
      elapsed: Math.round(performance.now() - start),
      body: text,
    }
  } catch (err) {
    return {
      status: 0,
      elapsed: Math.round(performance.now() - start),
      body: err instanceof Error ? err.message : String(err),
    }
  }
}

function ApiTesterRequestBuilder({
  body,
  handleMethodChange,
  handleSend,
  handleSendKeyDown,
  handleUrlChange,
  headers,
  isSending,
  method,
  setBody,
  setHeaders,
  url,
}: {
  body: string
  handleMethodChange: (e: ChangeEvent<HTMLSelectElement>) => void
  handleSend: () => Promise<void>
  handleSendKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  handleUrlChange: (e: ChangeEvent<HTMLInputElement>) => void
  headers: string
  isSending: boolean
  method: HttpMethod
  setBody: Dispatch<SetStateAction<string>>
  setHeaders: Dispatch<SetStateAction<string>>
  url: string
}) {
  return (
    <div className="api-tester-tile-request">
      <div className="api-tester-tile-request-row">
        <select
          className="api-tester-tile-method-select"
          value={method}
          onChange={handleMethodChange}
          style={{ color: getMethodColor(method) }}
          aria-label="HTTP method"
        >
          {HTTP_METHODS.map(m => (
            <option key={m} value={m} style={{ color: getMethodColor(m) }}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="api-tester-tile-url-input"
          type="text"
          placeholder="https://example.com/api/endpoint"
          value={url}
          onChange={handleUrlChange}
          onKeyDown={handleSendKeyDown}
          spellCheck={false}
          aria-label="Request URL"
        />
        <button
          className={`api-tester-tile-send-btn${isSending ? ' sending' : ''}`}
          onClick={() => void handleSend()}
          disabled={isSending || !url.trim()}
          aria-label="Send request"
        >
          {isSending ? '...' : 'send'}
        </button>
      </div>
      <div className="api-tester-tile-fields">
        <label className="api-tester-tile-field-label">headers</label>
        <textarea
          className="api-tester-tile-textarea"
          placeholder={'Content-Type: application/json\nAuthorization: Bearer token'}
          value={headers}
          onChange={e => setHeaders(e.target.value)}
          spellCheck={false}
          rows={3}
          aria-label="Request headers"
        />
        {method === 'POST' || method === 'PUT' || method === 'PATCH' ? (
          <>
            <label className="api-tester-tile-field-label">body</label>
            <textarea
              className="api-tester-tile-textarea"
              placeholder='{"key": "value"}'
              value={body}
              onChange={e => setBody(e.target.value)}
              spellCheck={false}
              rows={3}
              aria-label="Request body"
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

function ApiTesterResponsePanel({
  isSending,
  responseBody,
  responseStatus,
  responseTime,
}: {
  isSending: boolean
  responseBody: string
  responseStatus: number | null
  responseTime: number | null
}) {
  return (
    <div className="api-tester-tile-response">
      <div className="api-tester-tile-response-header">
        {responseStatus !== null ? (
          <>
            <span
              className="api-tester-tile-response-status"
              style={{ color: getStatusColor(responseStatus) }}
            >
              {responseStatus === 0 ? 'error' : responseStatus}
            </span>
            {responseTime !== null ? (
              <span className="api-tester-tile-response-time">{responseTime}ms</span>
            ) : null}
          </>
        ) : (
          <span className="api-tester-tile-response-empty-label">response</span>
        )}
      </div>
      <div className="api-tester-tile-response-body">
        {responseBody ? (
          <pre className="api-tester-tile-response-pre">{responseBody}</pre>
        ) : (
          <span className="api-tester-tile-response-placeholder">
            {isSending ? 'sending...' : 'no response yet'}
          </span>
        )}
      </div>
    </div>
  )
}
