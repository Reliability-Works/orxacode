import type { OrxaBridge } from "@shared/ipc";

declare global {
  const __APP_VERSION__: string;

  interface Window {
    orxa: OrxaBridge;
  }
}

export {};
