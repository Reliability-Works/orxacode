/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import { shouldRunOrxaBootstrap } from "./app-mode";

describe("shouldRunOrxaBootstrap", () => {
  it("skips bootstrap in standard mode", () => {
    expect(shouldRunOrxaBootstrap("standard")).toBe(false);
  });

  it("runs bootstrap in Orxa mode", () => {
    expect(shouldRunOrxaBootstrap("orxa")).toBe(true);
  });
});
