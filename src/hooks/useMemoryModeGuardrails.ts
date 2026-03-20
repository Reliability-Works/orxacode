import { useEffect, useRef } from "react";
import type { SessionMessageBundle } from "@shared/ipc";

const FORBIDDEN_EXTERNAL_MEMORY_PATTERN =
  /\b(supermemory|mem0|pinecone|qdrant|weaviate|chroma(?:db)?|milvus|vector\s*db)\b/i;
const FORBIDDEN_MEMORY_TOOL_NAME_PATTERN =
  /(supermemory|mem0|pinecone|qdrant|weaviate|chroma(?:db)?|milvus|vector\s*db)/i;
const ORXA_MEMORY_LINE_PATTERN = /^\[ORXA_MEMORY\]/im;
const SUPERMEMORY_STATUS_LINE_PATTERN = /^\[SUPERMEMORY\]/im;

type UseMemoryModeGuardrailsOptions = {
  activeProjectDir: string | null | undefined;
  activeSessionID: string | null | undefined;
  messages: SessionMessageBundle[];
  memoryModeEnabled: boolean;
  onGuardrailViolation?: (message: string) => void;
};

export function useMemoryModeGuardrails(options: UseMemoryModeGuardrailsOptions) {
  const seenBySessionRef = useRef<Record<string, Set<string>>>({});
  const onGuardrailViolationRef = useRef(options.onGuardrailViolation);
  const { activeProjectDir, activeSessionID, messages, memoryModeEnabled } = options;

  useEffect(() => {
    onGuardrailViolationRef.current = options.onGuardrailViolation;
  }, [options.onGuardrailViolation]);

  useEffect(() => {
    if (!memoryModeEnabled) {
      return;
    }
    const directory = activeProjectDir;
    const sessionID = activeSessionID;
    if (!directory || !sessionID) {
      return;
    }

    const sessionKey = `${directory}::${sessionID}`;
    const seen = seenBySessionRef.current[sessionKey] ?? new Set<string>();
    seenBySessionRef.current[sessionKey] = seen;

    for (const bundle of messages) {
      if (bundle.info.role !== "assistant") {
        continue;
      }

      for (const part of bundle.parts) {
        if (part.type !== "text") {
          continue;
        }
        const text = part.text.trim();
        if (!text || ORXA_MEMORY_LINE_PATTERN.test(text) || SUPERMEMORY_STATUS_LINE_PATTERN.test(text)) {
          continue;
        }
        const partID = "id" in part && typeof part.id === "string" ? part.id : `part-${text.slice(0, 32)}`;
        const key = `${String(bundle.info.id ?? "unknown")}:${partID}:text`;
        if (seen.has(key)) {
          continue;
        }
        if (FORBIDDEN_EXTERNAL_MEMORY_PATTERN.test(text)) {
          seen.add(key);
          onGuardrailViolationRef.current?.(
            "Blocked external memory tooling. Use only Orxa Code in-app memory.",
          );
          return;
        }
      }

      for (const part of bundle.parts) {
        if (part.type !== "tool" || typeof part.tool !== "string") {
          continue;
        }
        const toolName = part.tool.trim();
        if (!toolName || !FORBIDDEN_MEMORY_TOOL_NAME_PATTERN.test(toolName)) {
          continue;
        }
        const key = `${String(bundle.info.id ?? "unknown")}:${part.id}:tool:${toolName.toLowerCase()}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        onGuardrailViolationRef.current?.(
          `Blocked forbidden memory tool ("${toolName}"). Use only Orxa Code in-app memory.`,
        );
        return;
      }
    }
  }, [activeProjectDir, activeSessionID, memoryModeEnabled, messages]);
}
