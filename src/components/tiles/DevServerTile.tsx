import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Server } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";
import type { ListeningPort } from "@shared/ipc";
import { CanvasTileComponent } from "../CanvasTile";

interface DevServerTileProps {
  tile: CanvasTile;
  canvasTheme: CanvasTheme;
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void;
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  allTiles?: CanvasTile[];
}

const REFRESH_INTERVAL = 5000;

export function DevServerTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
}: DevServerTileProps) {
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const directory = typeof tile.meta.directory === "string" ? tile.meta.directory : undefined;

  const scanPorts = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.orxa?.app : undefined;
    if (!bridge?.scanPorts) return;

    setIsScanning(true);
    try {
      const result = await bridge.scanPorts(directory);
      setPorts(result);
      setLastScanTime(new Date().toLocaleTimeString());
    } catch {
      // Silently handle scan errors
    } finally {
      setIsScanning(false);
    }
  }, [directory]);

  // Scan on mount and every REFRESH_INTERVAL
  useEffect(() => {
    void scanPorts();
    intervalRef.current = setInterval(() => void scanPorts(), REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scanPorts]);

  const portCount = ports.length;
  const metaLabel = portCount > 0 ? `${portCount} port${portCount !== 1 ? "s" : ""}` : undefined;

  const statusBadge = (
    <span className={`dev-server-tile-status-badge ${portCount > 0 ? "running" : "stopped"}`}>
      <span className="dev-server-tile-status-dot" />
      {portCount > 0 ? `${portCount} listening` : "no ports"}
    </span>
  );

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<Server size={12} />}
      label="dev server"
      iconColor="#A78BFA"
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
    >
      <div className="dev-server-tile-body">
        <div className="dev-server-tile-toolbar">
          {statusBadge}
          <div className="dev-server-tile-toolbar-right">
            {lastScanTime && (
              <span className="dev-server-tile-scan-time">
                {lastScanTime}
              </span>
            )}
            <button
              className={`dev-server-tile-refresh-btn${isScanning ? " scanning" : ""}`}
              onClick={() => void scanPorts()}
              disabled={isScanning}
              title="Refresh ports"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        </div>
        <div className="dev-server-tile-table-wrapper">
          <table className="dev-server-tile-table">
            <thead>
              <tr>
                <th>port</th>
                <th>pid</th>
                <th>process</th>
              </tr>
            </thead>
            <tbody>
              {ports.length === 0 ? (
                <tr>
                  <td colSpan={3} className="dev-server-tile-empty">
                    {isScanning ? "scanning..." : "no listening ports detected"}
                  </td>
                </tr>
              ) : (
                ports.map((entry) => (
                  <tr key={entry.port}>
                    <td className="dev-server-tile-cell-port">{entry.port}</td>
                    <td className="dev-server-tile-cell-pid">{entry.pid}</td>
                    <td className="dev-server-tile-cell-process">{entry.command}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CanvasTileComponent>
  );
}
