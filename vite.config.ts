import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "shared"),
    },
  },
  plugins: [
    react(),
    renderer(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["keytar", "ws", "bufferutil", "utf-8-validate"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
      },
      renderer: {},
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["electron/services/app-mode.ts", "electron/services/plugin-config.ts", "src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "src/lib/services/**"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
