import { execFile as execFileCb } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { desktopCapturer } from "electron";
import type { OrxaEvent } from "../../shared/ipc/events";
import type { SimulatorDevice, SimulatorState, SimulatorScreenshot } from "../../shared/ipc/simulator";

const execFile = promisify(execFileCb);

type SimulatorControllerOptions = {
  onEvent?: (event: OrxaEvent) => void;
};

type SimctlDeviceEntry = {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier: string;
};

type SimctlListOutput = {
  devices: Record<string, SimctlDeviceEntry[]>;
};

function parseRuntimeName(runtimeId: string): string {
  // e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-2" -> "iOS 18.2"
  const suffix = runtimeId.replace(/^.*\.SimRuntime\./, "");
  return suffix.replace(/-/g, " ").replace(/(\d+) (\d+)/g, "$1.$2");
}

export class SimulatorController {
  private available = false;
  private devices: SimulatorDevice[] = [];
  private activeDeviceUdid: string | null = null;
  private capturing = false;
  private onEvent: ((event: OrxaEvent) => void) | undefined;

  constructor(options: SimulatorControllerOptions) {
    this.onEvent = options.onEvent;

    if (process.platform !== "darwin") {
      this.available = false;
      return;
    }

    // Check if xcrun exists asynchronously
    execFile("which", ["xcrun"])
      .then(() => {
        this.available = true;
        // Pre-populate device list
        void this.listDevices();
      })
      .catch(() => {
        this.available = false;
      });
  }

  getState(): SimulatorState {
    return {
      available: this.available,
      devices: this.devices,
      activeDeviceUdid: this.activeDeviceUdid,
      capturing: this.capturing,
    };
  }

  async refreshState(): Promise<SimulatorState> {
    if (process.platform !== "darwin") {
      return this.getState();
    }
    // Re-check xcrun availability
    try {
      await execFile("which", ["xcrun"]);
      this.available = true;
    } catch {
      this.available = false;
      return this.getState();
    }
    await this.listDevices();
    return this.getState();
  }

  async listDevices(): Promise<SimulatorDevice[]> {
    if (!this.available) {
      return [];
    }

    try {
      const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "--json"]);
      const parsed: SimctlListOutput = JSON.parse(stdout);

      const flatDevices: SimulatorDevice[] = [];
      for (const [runtimeId, entries] of Object.entries(parsed.devices)) {
        const runtime = parseRuntimeName(runtimeId);
        for (const entry of entries) {
          if (!entry.isAvailable) continue;
          flatDevices.push({
            udid: entry.udid,
            name: entry.name,
            state: entry.state as SimulatorDevice["state"],
            isAvailable: entry.isAvailable,
            deviceTypeIdentifier: entry.deviceTypeIdentifier,
            runtime,
          });
        }
      }

      this.devices = flatDevices;
      return flatDevices;
    } catch (error) {
      console.error("[SimulatorController] Failed to list devices:", error);
      return [];
    }
  }

  async bootDevice(udid: string): Promise<SimulatorState> {
    if (!this.available) {
      return this.getState();
    }

    try {
      await execFile("xcrun", ["simctl", "boot", udid]);
    } catch (error) {
      // Device may already be booted
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("current state: Booted")) {
        throw error;
      }
    }

    try {
      await execFile("open", ["-a", "Simulator"]);
    } catch {
      // Simulator.app may not be available; non-fatal
    }

    this.activeDeviceUdid = udid;
    await this.listDevices();
    this.emitState();
    return this.getState();
  }

  async shutdownDevice(udid: string): Promise<SimulatorState> {
    if (!this.available) {
      return this.getState();
    }

    try {
      await execFile("xcrun", ["simctl", "shutdown", udid]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("current state: Shutdown")) {
        throw error;
      }
    }

    if (this.activeDeviceUdid === udid) {
      this.activeDeviceUdid = null;
    }

    await this.listDevices();
    this.emitState();
    return this.getState();
  }

  selectDevice(udid: string): SimulatorState {
    this.activeDeviceUdid = udid;
    this.emitState();
    return this.getState();
  }

  async takeScreenshot(udid: string): Promise<SimulatorScreenshot> {
    if (!this.available) {
      throw new Error("Simulator is not available on this platform");
    }

    const timestamp = Date.now();
    const tempPath = `/tmp/orxa-sim-screenshot-${timestamp}.png`;

    try {
      await execFile("xcrun", ["simctl", "io", udid, "screenshot", "--type", "png", tempPath]);
      const buffer = await readFile(tempPath);
      const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

      try {
        await unlink(tempPath);
      } catch {
        // Non-fatal cleanup failure
      }

      const screenshot: SimulatorScreenshot = {
        dataUrl,
        deviceUdid: udid,
        timestamp,
      };

      this.onEvent?.({ type: "simulator.screenshot", payload: screenshot });
      return screenshot;
    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {
        // ignore
      }
      throw error;
    }
  }

  async getCaptureSourceId(udid: string): Promise<string | null> {
    const device = this.devices.find((d) => d.udid === udid);
    if (!device) {
      return null;
    }

    try {
      const sources = await desktopCapturer.getSources({ types: ["window"] });
      const match = sources.find((source) => source.name.includes(device.name));
      return match?.id ?? null;
    } catch {
      return null;
    }
  }

  private emitState(): void {
    this.onEvent?.({ type: "simulator.state", payload: this.getState() });
  }
}
