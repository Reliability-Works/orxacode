export type SimulatorDevice = {
  udid: string;
  name: string;
  state: "Booted" | "Shutdown" | "Creating" | "Booting" | "ShuttingDown";
  isAvailable: boolean;
  deviceTypeIdentifier: string;
  runtime: string;
};

export type SimulatorState = {
  available: boolean;
  devices: SimulatorDevice[];
  activeDeviceUdid: string | null;
  capturing: boolean;
};

export type SimulatorScreenshot = {
  dataUrl: string;
  deviceUdid: string;
  timestamp: number;
};
