import path from "node:path";
import Store from "electron-store";

type PersistedProjectState = {
  directories: string[];
};

export class ProjectStore {
  private store = new Store<PersistedProjectState>({
    name: "orxacode-project-directories",
    defaults: {
      directories: [],
    },
  });

  list() {
    const normalized = this.store.get("directories").map((directory) => path.resolve(directory));
    const unique = [...new Set(normalized)];
    if (unique.length !== normalized.length) {
      this.store.set("directories", unique);
    }
    return unique;
  }

  add(directory: string) {
    const normalized = path.resolve(directory);
    const existing = this.list();
    if (existing.includes(normalized)) {
      return existing;
    }
    const next = [normalized, ...existing];
    this.store.set("directories", next);
    return next;
  }

  remove(directory: string) {
    const normalized = path.resolve(directory);
    const next = this.list().filter((item) => item !== normalized);
    this.store.set("directories", next);
    return next;
  }
}
