import { memo, useCallback, useEffect, useState } from "react";
import { Camera, PanelRightClose, Play, Power, Smartphone } from "lucide-react";
import type { SimulatorDevice, SimulatorState } from "../../shared/ipc/simulator";

export type SimulatorSidebarProps = {
  simulatorState: SimulatorState;
  onSelectDevice: (udid: string) => void;
  onBootDevice: (udid: string) => void;
  onShutdownDevice: (udid: string) => void;
  onTakeScreenshot: (udid: string) => void;
  onRefreshDevices: () => void;
  onCollapse: () => void;
};

function groupByRuntime(devices: SimulatorDevice[]): Map<string, SimulatorDevice[]> {
  const groups = new Map<string, SimulatorDevice[]>();
  for (const device of devices) {
    const list = groups.get(device.runtime) ?? [];
    list.push(device);
    groups.set(device.runtime, list);
  }
  return groups;
}

function stateLabel(state: SimulatorDevice["state"]): string {
  switch (state) {
    case "Booted":
      return "Booted";
    case "Booting":
      return "Booting…";
    case "ShuttingDown":
      return "Shutting down…";
    default:
      return "Shutdown";
  }
}

export const SimulatorSidebar = memo(function SimulatorSidebar({
  simulatorState,
  onSelectDevice,
  onBootDevice,
  onShutdownDevice,
  onTakeScreenshot,
  onRefreshDevices,
  onCollapse,
}: SimulatorSidebarProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const selectedDevice = simulatorState.devices.find(
    (d) => d.udid === simulatorState.activeDeviceUdid,
  );
  const isBooted = selectedDevice?.state === "Booted";
  const isTransitioning =
    selectedDevice?.state === "Booting" || selectedDevice?.state === "ShuttingDown";
  const grouped = groupByRuntime(simulatorState.devices);

  // Refresh device list on mount
  useEffect(() => {
    onRefreshDevices();
  }, [onRefreshDevices]);

  // Poll screenshots for live preview when device is booted
  useEffect(() => {
    if (!isBooted || !simulatorState.activeDeviceUdid) {
      setFrameUrl(null);
      setCaptureError(null);
      return;
    }

    let cancelled = false;
    const udid = simulatorState.activeDeviceUdid;

    const poll = async () => {
      while (!cancelled) {
        try {
          const screenshot = await window.orxa.simulator.takeScreenshot(udid);
          if (cancelled) break;
          setFrameUrl(screenshot.dataUrl);
          setCaptureError(null);
        } catch {
          if (!cancelled) setCaptureError("Failed to capture simulator screen");
        }
        // Wait ~1.2s between frames
        await new Promise((r) => setTimeout(r, 1200));
      }
    };
    void poll();

    return () => { cancelled = true; };
  }, [isBooted, simulatorState.activeDeviceUdid]);

  const handleDeviceChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onSelectDevice(event.target.value);
    },
    [onSelectDevice],
  );

  const handleBoot = useCallback(() => {
    if (selectedDevice) onBootDevice(selectedDevice.udid);
  }, [onBootDevice, selectedDevice]);

  const handleShutdown = useCallback(() => {
    if (selectedDevice) onShutdownDevice(selectedDevice.udid);
  }, [onShutdownDevice, selectedDevice]);

  const handleScreenshot = useCallback(() => {
    if (selectedDevice) onTakeScreenshot(selectedDevice.udid);
  }, [onTakeScreenshot, selectedDevice]);

  if (!simulatorState.available) {
    return (
      <aside className="sidebar simulator-sidebar">
        <div className="simulator-sidebar-header">
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Simulator</span>
          <button
            type="button"
            className="simulator-sidebar-collapse"
            onClick={onCollapse}
            aria-label="Close simulator sidebar"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
        <div className="simulator-viewport-pane">
          <div className="simulator-viewport-placeholder">
            <Smartphone size={28} />
            <span>Xcode command-line tools not found</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              Install Xcode to use the simulator
            </span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar simulator-sidebar">
      <div className="simulator-sidebar-header">
        <select
          className="simulator-device-picker"
          value={simulatorState.activeDeviceUdid ?? ""}
          onChange={handleDeviceChange}
        >
          <option value="" disabled>
            Select device…
          </option>
          {[...grouped.entries()].map(([runtime, devices]) => (
            <optgroup key={runtime} label={runtime}>
              {devices.map((device) => (
                <option key={device.udid} value={device.udid}>
                  {device.name} {device.state === "Booted" ? "●" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          className="simulator-sidebar-collapse"
          onClick={onCollapse}
          aria-label="Close simulator sidebar"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="simulator-control-strip">
        <span
          className={`simulator-state-badge ${selectedDevice ? `state-${selectedDevice.state.toLowerCase()}` : ""}`}
        >
          {selectedDevice ? stateLabel(selectedDevice.state) : "No device"}
        </span>
        <div className="simulator-control-actions">
          <button
            type="button"
            className="simulator-control-btn screenshot"
            disabled={!isBooted}
            onClick={handleScreenshot}
            title="Take screenshot"
          >
            <Camera size={12} />
          </button>
          {isBooted ? (
            <button
              type="button"
              className="simulator-control-btn shutdown"
              disabled={isTransitioning}
              onClick={handleShutdown}
            >
              <Power size={12} />
              Shutdown
            </button>
          ) : (
            <button
              type="button"
              className="simulator-control-btn boot"
              disabled={!selectedDevice || isTransitioning}
              onClick={handleBoot}
            >
              <Play size={12} />
              Boot
            </button>
          )}
        </div>
      </div>

      <div className="simulator-viewport-pane">
        {isBooted ? (
          captureError && !frameUrl ? (
            <div className="simulator-viewport-placeholder">
              <Smartphone size={28} />
              <span>{captureError}</span>
            </div>
          ) : frameUrl ? (
            <img src={frameUrl} alt="Simulator screen" draggable={false} />
          ) : (
            <div className="simulator-viewport-placeholder">
              <Smartphone size={28} />
              <span>Capturing…</span>
            </div>
          )
        ) : (
          <div className="simulator-viewport-placeholder">
            <Smartphone size={28} />
            <span>
              {selectedDevice
                ? "Boot the simulator to see a live preview"
                : "Select a device to get started"}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
});
