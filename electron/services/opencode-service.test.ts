/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import { updateOrxaPluginInConfigDocument } from "./plugin-config";

describe("updateOrxaPluginInConfigDocument", () => {
  it("adds Orxa plugin in Orxa mode", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3"
  ]
}\n`;

    const result = updateOrxaPluginInConfigDocument(input, "orxa");
    expect(result.changed).toBe(true);
    expect(result.output).toContain('"example/plugin@1.2.3"');
    expect(result.output).toContain('"@reliabilityworks/opencode-orxa@1.0.43"');
  });

  it("removes Orxa plugin in standard mode and stays idempotent", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3",
    "@reliabilityworks/opencode-orxa@1.0.43"
  ]
}\n`;

    const removed = updateOrxaPluginInConfigDocument(input, "standard");
    expect(removed.changed).toBe(true);
    expect(removed.output).toContain('"example/plugin@1.2.3"');
    expect(removed.output).not.toContain("opencode-orxa");

    const secondPass = updateOrxaPluginInConfigDocument(removed.output, "standard");
    expect(secondPass.changed).toBe(false);
  });
});
