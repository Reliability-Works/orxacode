import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC } from "../../shared/ipc/channels";
import type { SimulatorController } from "../services/simulator-controller";
import { assertSimulatorUdid } from "./validators-simulator";

type SimulatorHandlersDeps = {
  getSimulatorController: () => SimulatorController | null;
  assertSender: (event: IpcMainInvokeEvent) => void;
};

function requireController(get: () => SimulatorController | null): SimulatorController {
  const ctrl = get();
  if (!ctrl) throw new Error("Simulator controller not initialized");
  return ctrl;
}

export function registerSimulatorHandlers({ getSimulatorController, assertSender }: SimulatorHandlersDeps) {
  ipcMain.handle(IPC.simulatorGetState, async (event) => {
    assertSender(event);
    return requireController(getSimulatorController).getState();
  });

  ipcMain.handle(IPC.simulatorListDevices, async (event) => {
    assertSender(event);
    return requireController(getSimulatorController).listDevices();
  });

  ipcMain.handle(IPC.simulatorBootDevice, async (event, udid: unknown) => {
    assertSender(event);
    return requireController(getSimulatorController).bootDevice(assertSimulatorUdid(udid));
  });

  ipcMain.handle(IPC.simulatorShutdownDevice, async (event, udid: unknown) => {
    assertSender(event);
    return requireController(getSimulatorController).shutdownDevice(assertSimulatorUdid(udid));
  });

  ipcMain.handle(IPC.simulatorSelectDevice, async (event, udid: unknown) => {
    assertSender(event);
    return requireController(getSimulatorController).selectDevice(assertSimulatorUdid(udid));
  });

  ipcMain.handle(IPC.simulatorTakeScreenshot, async (event, udid: unknown) => {
    assertSender(event);
    return requireController(getSimulatorController).takeScreenshot(assertSimulatorUdid(udid));
  });

  ipcMain.handle(IPC.simulatorGetCaptureSourceId, async (event, udid: unknown) => {
    assertSender(event);
    return requireController(getSimulatorController).getCaptureSourceId(assertSimulatorUdid(udid));
  });
}
