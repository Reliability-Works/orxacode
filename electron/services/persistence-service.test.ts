import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceService } from "./persistence-service";

const tempDirs: string[] = [];

async function createService() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orxa-persistence-"));
  tempDirs.push(dir);
  return {
    dir,
    service: new PersistenceService(path.join(dir, "state.sqlite")),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PersistenceService", () => {
  it("stores and reloads renderer values across service instances", async () => {
    const { dir, service } = await createService();
    service.setRendererValue("orxa:test:key", JSON.stringify({ ok: true }));

    const reloaded = new PersistenceService(path.join(dir, "state.sqlite"));
    expect(reloaded.getRendererValue("orxa:test:key")).toBe(JSON.stringify({ ok: true }));
  });

  it("removes renderer values", async () => {
    const { service } = await createService();
    service.setRendererValue("orxa:test:key", "value");
    service.removeRendererValue("orxa:test:key");
    expect(service.getRendererValue("orxa:test:key")).toBeNull();
  });

  it("stores and lists non-renderer namespace values", async () => {
    const { dir, service } = await createService();
    service.setValue("provider-runtime:v1", "session-a", JSON.stringify({ ok: true }));

    const reloaded = new PersistenceService(path.join(dir, "state.sqlite"));
    expect(reloaded.getValue("provider-runtime:v1", "session-a")).toBe(JSON.stringify({ ok: true }));
    expect(reloaded.listValues("provider-runtime:v1")).toEqual([
      expect.objectContaining({
        namespace: "provider-runtime:v1",
        key: "session-a",
        value: JSON.stringify({ ok: true }),
      }),
    ]);
  });
});
