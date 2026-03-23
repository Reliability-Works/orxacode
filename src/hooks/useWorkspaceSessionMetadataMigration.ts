import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { ProjectBootstrap, ProjectListItem } from "@shared/ipc";
import { opencodeClient } from "../lib/services/opencodeClient";
import {
  LEGACY_SESSION_TITLES_KEY,
  LEGACY_SESSION_TYPES_KEY,
  readLocalStorageRecord,
} from "./useWorkspaceSessionMetadata";
import {
  migrateLegacySessionMetadata,
  type WorkspaceSessionReference,
} from "../lib/workspace-session-metadata";
import type { SessionType } from "../types/canvas";

type UseWorkspaceSessionMetadataMigrationInput = {
  projects: ProjectListItem[];
  projectData?: ProjectBootstrap;
  projectDataByDirectory: Record<string, ProjectBootstrap>;
  setProjectDataForDirectory: (directory: string, project: ProjectBootstrap) => void;
  bumpProjectCacheVersion: () => void;
  setSessionTypes: Dispatch<SetStateAction<Record<string, SessionType>>>;
  setSessionTitles: Dispatch<SetStateAction<Record<string, string>>>;
};

export function useWorkspaceSessionMetadataMigration({
  projects,
  projectData,
  projectDataByDirectory,
  setProjectDataForDirectory,
  bumpProjectCacheVersion,
  setSessionTypes,
  setSessionTitles,
}: UseWorkspaceSessionMetadataMigrationInput) {
  const sessionMetadataMigrationDoneRef = useRef(false);

  useEffect(() => {
    if (sessionMetadataMigrationDoneRef.current || projects.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const legacyTypes = readLocalStorageRecord<SessionType>(LEGACY_SESSION_TYPES_KEY);
      const legacyTitles = readLocalStorageRecord<string>(LEGACY_SESSION_TITLES_KEY);
      if (Object.keys(legacyTypes).length === 0 && Object.keys(legacyTitles).length === 0) {
        sessionMetadataMigrationDoneRef.current = true;
        return;
      }

      const discoveredSessions: WorkspaceSessionReference[] = [];
      let fullyLoaded = true;

      for (const project of projects) {
        let data: ProjectBootstrap | undefined =
          projectData?.directory === project.worktree
            ? projectData
            : projectDataByDirectory[project.worktree];

        if (!data) {
          data = await opencodeClient.refreshProject(project.worktree).catch(() => undefined);
          if (data) {
            setProjectDataForDirectory(project.worktree, data);
            bumpProjectCacheVersion();
          } else {
            fullyLoaded = false;
            continue;
          }
        }

        for (const session of data.sessions) {
          if (session.time.archived) {
            continue;
          }
          discoveredSessions.push({
            directory: project.worktree,
            sessionID: session.id,
          });
        }
      }

      if (cancelled) {
        return;
      }

      if (Object.keys(legacyTypes).length > 0) {
        setSessionTypes((current) => migrateLegacySessionMetadata(legacyTypes, current, discoveredSessions));
      }
      if (Object.keys(legacyTitles).length > 0) {
        setSessionTitles((current) => migrateLegacySessionMetadata(legacyTitles, current, discoveredSessions));
      }

      if (fullyLoaded) {
        window.localStorage.removeItem(LEGACY_SESSION_TYPES_KEY);
        window.localStorage.removeItem(LEGACY_SESSION_TITLES_KEY);
        sessionMetadataMigrationDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bumpProjectCacheVersion,
    projectData,
    projectDataByDirectory,
    projects,
    setProjectDataForDirectory,
    setSessionTitles,
    setSessionTypes,
  ]);
}
