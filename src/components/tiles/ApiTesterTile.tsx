import { useCallback, useState } from "react";
import { Zap } from "lucide-react";
import { CanvasTileComponent } from "../CanvasTile";
import type { CanvasTileComponentProps } from "./tile-shared";

type ApiTesterTileProps = CanvasTileComponentProps;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

function getMethodColor(method: HttpMethod): string {
  switch (method) {
    case "GET":    return "#22C55E";
    case "POST":   return "#3B82F6";
    case "PUT":    return "#F59E0B";
    case "DELETE": return "#EF4444";
    case "PATCH":  return "#A78BFA";
  }
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return "#22C55E";
  if (status >= 400)                  return "#EF4444";
  return "var(--text-secondary)";
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
  const [method, setMethod] = useState<HttpMethod>(
    (tile.meta.method as HttpMethod) ?? "GET"
  );
  const [url, setUrl] = useState<string>(
    typeof tile.meta.url === "string" ? tile.meta.url : ""
  );
  const [headers, setHeaders] = useState<string>(
    typeof tile.meta.headers === "string" ? tile.meta.headers : ""
  );
  const [body, setBody] = useState<string>(
    typeof tile.meta.body === "string" ? tile.meta.body : ""
  );

  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<string>("");
  const [isSending, setIsSending] = useState(false);

  const metaLabel = url ? `${method} ${url}` : method;

  const syncMeta = useCallback(
    (updates: Partial<{ method: HttpMethod; url: string }>) => {
      onUpdate(tile.id, {
        meta: {
          ...tile.meta,
          method: updates.method ?? method,
          url: updates.url ?? url,
        },
      });
    },
    [tile.id, tile.meta, method, url, onUpdate]
  );

  const handleMethodChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const m = e.target.value as HttpMethod;
      setMethod(m);
      syncMeta({ method: m });
    },
    [syncMeta]
  );

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const u = e.target.value;
      setUrl(u);
      syncMeta({ url: u });
    },
    [syncMeta]
  );

  const handleSend = useCallback(async () => {
    if (!url.trim()) return;
    setIsSending(true);
    setResponseStatus(null);
    setResponseTime(null);
    setResponseBody("");

    const parsedHeaders: Record<string, string> = {};
    for (const line of headers.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > -1) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key) parsedHeaders[key] = value;
      }
    }

    const bridge = typeof window !== "undefined" ? window.orxa?.app : undefined;

    if (bridge?.httpRequest) {
      // Route through main process to avoid CORS
      try {
        const result = await bridge.httpRequest({
          method,
          url,
          headers: parsedHeaders,
          body: method !== "GET" && method !== "DELETE" && body.trim() ? body : undefined,
        });
        setResponseStatus(result.status);
        setResponseTime(result.elapsed);
        setResponseBody(result.body);
      } catch (err) {
        setResponseStatus(0);
        setResponseTime(0);
        setResponseBody(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSending(false);
      }
    } else {
      // Fallback to renderer fetch (will be subject to CORS)
      const start = performance.now();
      try {
        const init: RequestInit = {
          method,
          headers: parsedHeaders,
        };
        if (method !== "GET" && method !== "DELETE" && body.trim()) {
          init.body = body;
        }
        const response = await fetch(url, init);
        const elapsed = Math.round(performance.now() - start);
        const text = await response.text();
        setResponseStatus(response.status);
        setResponseTime(elapsed);
        setResponseBody(text);
      } catch (err) {
        const elapsed = Math.round(performance.now() - start);
        setResponseStatus(0);
        setResponseTime(elapsed);
        setResponseBody(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSending(false);
      }
    }
  }, [url, method, headers, body]);

  const handleSendKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        void handleSend();
      }
    },
    [handleSend]
  );

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
        {/* ---- Request builder ---- */}
        <div className="api-tester-tile-request">
          <div className="api-tester-tile-request-row">
            <select
              className="api-tester-tile-method-select"
              value={method}
              onChange={handleMethodChange}
              style={{ color: getMethodColor(method) }}
              aria-label="HTTP method"
            >
              {HTTP_METHODS.map((m) => (
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
              className={`api-tester-tile-send-btn${isSending ? " sending" : ""}`}
              onClick={() => void handleSend()}
              disabled={isSending || !url.trim()}
              aria-label="Send request"
            >
              {isSending ? "..." : "send"}
            </button>
          </div>
          <div className="api-tester-tile-fields">
            <label className="api-tester-tile-field-label">headers</label>
            <textarea
              className="api-tester-tile-textarea"
              placeholder={"Content-Type: application/json\nAuthorization: Bearer token"}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              spellCheck={false}
              rows={3}
              aria-label="Request headers"
            />
            {(method === "POST" || method === "PUT" || method === "PATCH") && (
              <>
                <label className="api-tester-tile-field-label">body</label>
                <textarea
                  className="api-tester-tile-textarea"
                  placeholder='{"key": "value"}'
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck={false}
                  rows={3}
                  aria-label="Request body"
                />
              </>
            )}
          </div>
        </div>

        {/* ---- Response viewer ---- */}
        <div className="api-tester-tile-response">
          <div className="api-tester-tile-response-header">
            {responseStatus !== null ? (
              <>
                <span
                  className="api-tester-tile-response-status"
                  style={{ color: getStatusColor(responseStatus) }}
                >
                  {responseStatus === 0 ? "error" : responseStatus}
                </span>
                {responseTime !== null && (
                  <span className="api-tester-tile-response-time">
                    {responseTime}ms
                  </span>
                )}
              </>
            ) : (
              <span className="api-tester-tile-response-empty-label">
                response
              </span>
            )}
          </div>
          <div className="api-tester-tile-response-body">
            {responseBody ? (
              <pre className="api-tester-tile-response-pre">{responseBody}</pre>
            ) : (
              <span className="api-tester-tile-response-placeholder">
                {isSending ? "sending..." : "no response yet"}
              </span>
            )}
          </div>
        </div>
      </div>
    </CanvasTileComponent>
  );
}
