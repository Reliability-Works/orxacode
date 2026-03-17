import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc";
import type { OpencodeService } from "../services/opencode-service";
import {
  assertArtifactExportBundleInput,
  assertArtifactListQuery,
  assertArtifactRetentionUpdateInput,
  assertMemoryGraphQuery,
  assertMemorySettingsUpdateInput,
  assertString,
  assertWorkspaceContextWriteInput,
} from "./validators";

type MemoryArtifactHandlersDeps = {
  service: OpencodeService;
};

export function registerMemoryArtifactHandlers({ service }: MemoryArtifactHandlersDeps) {
  ipcMain.handle(IPC.opencodeArtifactsList, async (_event, query?: unknown) =>
    service.listArtifacts(assertArtifactListQuery(query)),
  );
  ipcMain.handle(IPC.opencodeArtifactsGet, async (_event, id: unknown) =>
    service.getArtifact(assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeArtifactsDelete, async (_event, id: unknown) =>
    service.deleteArtifact(assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeArtifactsListSessions, async (_event, workspace: unknown) =>
    service.listArtifactSessions(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeArtifactsListWorkspaceSummary, async (_event, workspace: unknown) =>
    service.listWorkspaceArtifactSummary(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeArtifactsGetRetention, async () => service.getArtifactRetentionPolicy());
  ipcMain.handle(IPC.opencodeArtifactsSetRetention, async (_event, input: unknown) =>
    service.setArtifactRetentionPolicy(assertArtifactRetentionUpdateInput(input)),
  );
  ipcMain.handle(IPC.opencodeArtifactsPrune, async (_event, workspace?: unknown) =>
    service.pruneArtifactsNow(typeof workspace === "string" ? workspace : undefined),
  );
  ipcMain.handle(IPC.opencodeArtifactsExportBundle, async (_event, input: unknown) =>
    service.exportArtifactBundle(assertArtifactExportBundleInput(input)),
  );

  ipcMain.handle(IPC.opencodeContextList, async (_event, workspace: unknown) =>
    service.listWorkspaceContext(assertString(workspace, "workspace")),
  );
  ipcMain.handle(IPC.opencodeContextRead, async (_event, workspace: unknown, id: unknown) =>
    service.readWorkspaceContext(assertString(workspace, "workspace"), assertString(id, "id")),
  );
  ipcMain.handle(IPC.opencodeContextWrite, async (_event, input: unknown) =>
    service.writeWorkspaceContext(assertWorkspaceContextWriteInput(input)),
  );
  ipcMain.handle(IPC.opencodeContextDelete, async (_event, workspace: unknown, id: unknown) =>
    service.deleteWorkspaceContext(assertString(workspace, "workspace"), assertString(id, "id")),
  );

  ipcMain.handle(IPC.opencodeMemoryGetSettings, async (_event, directory?: unknown) =>
    service.getMemorySettings(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryUpdateSettings, async (_event, input: unknown) =>
    service.updateMemorySettings(assertMemorySettingsUpdateInput(input)),
  );
  ipcMain.handle(IPC.opencodeMemoryListTemplates, async () => service.listMemoryTemplates());
  ipcMain.handle(IPC.opencodeMemoryApplyTemplate, async (_event, templateID: unknown, directory?: unknown, scope?: unknown) => {
    const parsedScope = scope === undefined
      ? undefined
      : scope === "global" || scope === "workspace"
        ? scope
        : (() => {
            throw new Error("Invalid memory template scope");
          })();
    return service.applyMemoryTemplate(
      assertString(templateID, "templateID"),
      typeof directory === "string" ? directory : undefined,
      parsedScope,
    );
  });
  ipcMain.handle(IPC.opencodeMemoryGetGraph, async (_event, query?: unknown) =>
    service.getMemoryGraph(assertMemoryGraphQuery(query)),
  );
  ipcMain.handle(IPC.opencodeMemoryBackfill, async (_event, directory?: unknown) =>
    service.backfillMemory(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryClearWorkspace, async (_event, directory: unknown) =>
    service.clearWorkspaceMemory(assertString(directory, "directory")),
  );
}
