import type { AppMode } from "../../shared/ipc";

export function shouldRunOrxaBootstrap(mode: AppMode) {
  return mode === "orxa";
}
