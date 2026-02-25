import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRendererHtmlPath } from "./renderer-entry";

describe("resolveRendererHtmlPath", () => {
  it("resolves packaged app path to app.asar/dist/index.html", () => {
    const mainDir = "/Applications/Opencode Orxa.app/Contents/Resources/app.asar/dist-electron";
    const expected = path.resolve(
      "/Applications/Opencode Orxa.app/Contents/Resources/app.asar/dist/index.html",
    );

    expect(resolveRendererHtmlPath(mainDir)).toBe(expected);
  });

  it("resolves development build path to dist/index.html beside dist-electron", () => {
    const mainDir = "/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa/dist-electron";
    const expected = path.resolve("/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa/dist/index.html");

    expect(resolveRendererHtmlPath(mainDir)).toBe(expected);
  });
});
