import Store from "electron-store";
import type { AppMode } from "../../shared/ipc";

type ModeState = {
  mode: AppMode;
  version: 1;
};

export class ModeStore {
  private store = new Store<ModeState>({
    name: "app-mode",
    defaults: {
      mode: "standard",
      version: 1,
    },
  });

  getMode(): AppMode {
    return this.store.get("mode");
  }

  setMode(mode: AppMode): AppMode {
    this.store.set("mode", mode);
    return this.getMode();
  }
}
