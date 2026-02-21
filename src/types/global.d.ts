import type { OrxaBridge } from "@shared/ipc";

declare global {
  interface Window {
    orxa: OrxaBridge;
  }
}

export {};
