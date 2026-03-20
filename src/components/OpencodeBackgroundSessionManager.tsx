import { useEffect } from "react";
import { normalizeMessageBundles } from "../hooks/useWorkspaceState";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

type Props = {
  directory: string;
  sessionID: string;
};

const OPENCODE_BACKGROUND_POLL_MS = 1500;

export function OpencodeBackgroundSessionManager({ directory, sessionID }: Props) {
  const setOpencodeRuntimeSnapshot = useUnifiedRuntimeStore((state) => state.setOpencodeRuntimeSnapshot);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      if (!window.orxa?.opencode) {
        return;
      }
      try {
        const runtime = await window.orxa.opencode.getSessionRuntime(directory, sessionID);
        if (cancelled) {
          return;
        }
        setOpencodeRuntimeSnapshot(directory, sessionID, {
          ...runtime,
          messages: normalizeMessageBundles(runtime.messages),
        });
      } catch {
        // Background supervision is best-effort only.
      }
    };

    void sync();
    const timer = window.setInterval(() => {
      void sync();
    }, OPENCODE_BACKGROUND_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [directory, sessionID, setOpencodeRuntimeSnapshot]);

  return null;
}
