import { describe, expect, it } from "vitest";
import { buildOpenTargetAttempts } from "./open-target-attempts";
import type { OpenDirectoryTarget } from "../../shared/ipc";

const TARGETS: OpenDirectoryTarget[] = ["finder", "cursor", "antigravity", "terminal", "ghostty", "xcode", "zed"];

describe("buildOpenTargetAttempts", () => {
  it("matches expected darwin command ordering for directory and file modes", () => {
    for (const target of TARGETS) {
      const directoryAttempts = buildOpenTargetAttempts({
        platform: "darwin",
        target,
        resolvedPath: "/repo",
        mode: "directory",
      });
      const fileAttempts = buildOpenTargetAttempts({
        platform: "darwin",
        target,
        resolvedPath: "/repo/file.ts",
        mode: "file",
      });

      if (target === "finder") {
        expect(directoryAttempts).toEqual([{ command: "open", args: ["/repo"], label: "Finder" }]);
        expect(fileAttempts).toEqual([{ command: "open", args: ["-R", "/repo/file.ts"], label: "Finder" }]);
        continue;
      }

      if (target === "cursor") {
        expect(directoryAttempts).toEqual([
          { command: "open", args: ["-a", "Cursor", "/repo"], label: "Cursor" },
          { command: "cursor", args: ["/repo"], label: "Cursor CLI" },
        ]);
        expect(fileAttempts).toEqual([
          { command: "open", args: ["-a", "Cursor", "/repo/file.ts"], label: "Cursor" },
          { command: "cursor", args: ["/repo/file.ts"], label: "Cursor CLI" },
        ]);
        continue;
      }

      if (target === "antigravity") {
        expect(directoryAttempts).toEqual([{ command: "open", args: ["-a", "Antigravity", "/repo"], label: "Antigravity" }]);
        expect(fileAttempts).toEqual([{ command: "open", args: ["-a", "Antigravity", "/repo/file.ts"], label: "Antigravity" }]);
        continue;
      }

      if (target === "terminal") {
        expect(directoryAttempts).toEqual([{ command: "open", args: ["-a", "Terminal", "/repo"], label: "Terminal" }]);
        expect(fileAttempts).toEqual([{ command: "open", args: ["-a", "Terminal", "/repo/file.ts"], label: "Terminal" }]);
        continue;
      }

      if (target === "ghostty") {
        expect(directoryAttempts).toEqual([{ command: "open", args: ["-a", "Ghostty", "/repo"], label: "Ghostty" }]);
        expect(fileAttempts).toEqual([{ command: "open", args: ["-a", "Ghostty", "/repo/file.ts"], label: "Ghostty" }]);
        continue;
      }

      if (target === "xcode") {
        expect(directoryAttempts).toEqual([{ command: "open", args: ["-a", "Xcode", "/repo"], label: "Xcode" }]);
        expect(fileAttempts).toEqual([{ command: "open", args: ["-a", "Xcode", "/repo/file.ts"], label: "Xcode" }]);
        continue;
      }

      expect(directoryAttempts).toEqual([
        { command: "open", args: ["-a", "Zed", "/repo"], label: "Zed" },
        { command: "zed", args: ["/repo"], label: "Zed CLI" },
      ]);
      expect(fileAttempts).toEqual([
        { command: "open", args: ["-a", "Zed", "/repo/file.ts"], label: "Zed" },
        { command: "zed", args: ["/repo/file.ts"], label: "Zed CLI" },
      ]);
    }
  });

  it("matches expected non-darwin command ordering for directory and file modes", () => {
    for (const target of TARGETS) {
      const directoryAttempts = buildOpenTargetAttempts({
        platform: "linux",
        target,
        resolvedPath: "/repo",
        mode: "directory",
      });
      const fileAttempts = buildOpenTargetAttempts({
        platform: "linux",
        target,
        resolvedPath: "/repo/file.ts",
        mode: "file",
      });

      if (target === "finder") {
        expect(directoryAttempts).toEqual([{ command: "xdg-open", args: ["/repo"], label: "File manager" }]);
        expect(fileAttempts).toEqual([{ command: "xdg-open", args: ["/repo/file.ts"], label: "File manager" }]);
        continue;
      }

      if (target === "cursor") {
        expect(directoryAttempts).toEqual([{ command: "cursor", args: ["/repo"], label: "Cursor" }]);
        expect(fileAttempts).toEqual([{ command: "cursor", args: ["/repo/file.ts"], label: "Cursor" }]);
        continue;
      }

      if (target === "antigravity") {
        expect(directoryAttempts).toEqual([{ command: "antigravity", args: ["/repo"], label: "Antigravity" }]);
        expect(fileAttempts).toEqual([{ command: "antigravity", args: ["/repo/file.ts"], label: "Antigravity" }]);
        continue;
      }

      if (target === "terminal") {
        expect(directoryAttempts).toEqual([
          { command: "ghostty", args: ["--working-directory", "/repo"], label: "Ghostty" },
          { command: "x-terminal-emulator", args: ["--working-directory", "/repo"], label: "Terminal" },
        ]);
        expect(fileAttempts).toEqual([
          { command: "ghostty", args: ["/repo/file.ts"], label: "Ghostty" },
          { command: "x-terminal-emulator", args: ["/repo/file.ts"], label: "Terminal" },
        ]);
        continue;
      }

      if (target === "ghostty") {
        expect(directoryAttempts).toEqual([{ command: "ghostty", args: ["--working-directory", "/repo"], label: "Ghostty" }]);
        expect(fileAttempts).toEqual([{ command: "ghostty", args: ["/repo/file.ts"], label: "Ghostty" }]);
        continue;
      }

      if (target === "xcode") {
        expect(directoryAttempts).toEqual([{ command: "xdg-open", args: ["/repo"], label: "Editor" }]);
        expect(fileAttempts).toEqual([{ command: "xdg-open", args: ["/repo/file.ts"], label: "Editor" }]);
        continue;
      }

      expect(directoryAttempts).toEqual([{ command: "zed", args: ["/repo"], label: "Zed" }]);
      expect(fileAttempts).toEqual([{ command: "zed", args: ["/repo/file.ts"], label: "Zed" }]);
    }
  });
});
