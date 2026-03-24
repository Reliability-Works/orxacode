import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version?: string };
const appVersion = packageJson.version ?? "0.0.0-dev";

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "shared"),
    },
  },
  plugins: [
    react(),
    ...(mode === "test"
      ? []
      : [
          renderer(),
          electron({
            main: {
              entry: "electron/main.ts",
              vite: {
                build: {
                  rollupOptions: {
                    external: ["better-sqlite3", "keytar", "node-pty", "bufferutil", "utf-8-validate"],
                  },
                },
              },
            },
            preload: {
              input: "electron/preload.ts",
            },
            renderer: {},
          }),
        ]),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "electron/services/auto-updater.ts",
        "electron/services/startup-bootstrap.ts",
        "electron/services/ipc-event-hub.ts",
        "src/lib/**/*.ts",
        "src/hooks/usePersistedState.ts",
        "src/components/MessageFeed.tsx",
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "src/lib/services/**", "src/lib/file-icons.tsx"],
      thresholds: {
        statements: 75,
        branches: 64,
        functions: 75,
        lines: 75,
      },
    },
  },
}));
