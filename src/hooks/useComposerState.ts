import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Attachment = {
  url: string;
  filename: string;
  mime: string;
  path: string;
};

type ComposerSession = {
  id: string;
  title?: string;
};

type SlashCommand = {
  name: string;
  description?: string;
};

export type ModelPayload = {
  providerID: string;
  modelID: string;
};

export type SendPromptInput = {
  textOverride?: string;
  systemAddendum?: string;
  promptSource?: "user" | "job" | "machine";
  tools?: Record<string, boolean>;
};

type UseComposerStateOptions = {
  availableSlashCommands: SlashCommand[];
  refreshMessages: () => Promise<unknown>;
  refreshProject: (directory: string) => Promise<unknown>;
  sessions: ComposerSession[];
  selectedAgent?: string;
  availableAgentNames: Set<string>;
  setStatusLine: (status: string) => void;
  shouldAutoRenameSessionTitle: (title: string | undefined) => boolean;
  deriveSessionTitleFromPrompt: (prompt: string, maxLength?: number) => string;
  startResponsePolling: (directory: string, sessionID: string) => void;
  stopResponsePolling: () => void;
  clearPendingSession: () => void;
  onSessionAbortRequested?: (directory: string, sessionID: string) => void;
};

// Per-workspace composer text cache (survives workspace switches)
const composerByWorkspace = new Map<string, string>();

export function useComposerState(activeProjectDir: string | null, activeSessionID: string | null, options: UseComposerStateOptions) {
  const [composer, setComposerRaw] = useState(() => (activeProjectDir ? composerByWorkspace.get(activeProjectDir) ?? "" : ""));
  const prevProjectDirRef = useRef(activeProjectDir);

  // Sync composer text when switching workspaces
  useEffect(() => {
    const prev = prevProjectDirRef.current;
    if (prev === activeProjectDir) return;
    // Save current text for the previous workspace (including empty string)
    if (prev) {
      composerByWorkspace.set(prev, composer);
    }
    // Restore text for the new workspace
    prevProjectDirRef.current = activeProjectDir;
    setComposerRaw(activeProjectDir ? composerByWorkspace.get(activeProjectDir) ?? "" : "");
  }, [activeProjectDir, composer]);

  // Wrapper that also updates the cache
  const setComposer = useCallback((value: string | ((prev: string) => string)) => {
    setComposerRaw((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (activeProjectDir) {
        composerByWorkspace.set(activeProjectDir, next);
      }
      return next;
    });
  }, [activeProjectDir]);

  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([]);
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const sendingPromptRef = useRef(false);
  const lastSendRef = useRef<{ token: string; at: number } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>();
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const filteredSlashCommands = useMemo(() => {
    const query = slashQuery.toLowerCase();
    if (!query) {
      return options.availableSlashCommands;
    }
    return options.availableSlashCommands.filter(
      (cmd) => cmd.name.toLowerCase().includes(query) || (cmd.description?.toLowerCase().includes(query) ?? false),
    );
  }, [options.availableSlashCommands, slashQuery]);

  const handleComposerChange = useCallback((value: string) => {
    setComposer(value);

    const lines = value.split("\n");
    const currentLine = lines[lines.length - 1];

    if (currentLine.startsWith("/") && !currentLine.includes(" ")) {
      const query = currentLine.slice(1);
      setSlashQuery(query);
      setSlashMenuOpen(true);
      setSlashSelectedIndex(0);
    } else {
      setSlashMenuOpen((open) => {
        if (open) {
          return false;
        }
        return open;
      });
    }
  }, [setComposer]);

  const insertSlashCommand = useCallback((commandName: string) => {
    setComposer((prev) => {
      const lines = prev.split("\n");
      lines[lines.length - 1] = `/${commandName} `;
      return lines.join("\n");
    });
    setSlashMenuOpen(false);
    setSlashQuery("");
  }, [setComposer]);

  const filteredSlashCommandsRef = useRef(filteredSlashCommands);
  useEffect(() => {
    filteredSlashCommandsRef.current = filteredSlashCommands;
  }, [filteredSlashCommands]);

  const slashSelectedIndexRef = useRef(slashSelectedIndex);
  useEffect(() => {
    slashSelectedIndexRef.current = slashSelectedIndex;
  }, [slashSelectedIndex]);

  const handleSlashKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const commands = filteredSlashCommandsRef.current;
        setSlashSelectedIndex((current) => (current < commands.length - 1 ? current + 1 : current));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashSelectedIndex((current) => (current > 0 ? current - 1 : 0));
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const commands = filteredSlashCommandsRef.current;
        const selectedIdx = slashSelectedIndexRef.current;
        const command = commands[selectedIdx];
        if (command) {
          insertSlashCommand(command.name);
        }
      } else if (event.key === "Escape") {
        setSlashMenuOpen(false);
      }
    },
    [insertSlashCommand],
  );

  const addComposerAttachments = useCallback((attachments: Attachment[]) => {
    if (attachments.length === 0) {
      return;
    }
    setComposerAttachments((current) => {
      const seen = new Set(current.map((item) => item.url));
      const next: Attachment[] = [];
      for (const attachment of attachments) {
        if (!attachment.url || seen.has(attachment.url)) {
          continue;
        }
        seen.add(attachment.url);
        next.push(attachment);
      }
      if (next.length === 0) {
        return current;
      }
      return [...current, ...next];
    });
  }, []);

  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage();
      if (!selection) {
        return;
      }
      addComposerAttachments([selection]);
    } catch (error) {
      options.setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [addComposerAttachments, options]);

  const removeAttachment = useCallback((url: string) => {
    setComposerAttachments((current) => current.filter((item) => item.url !== url));
  }, []);

  const selectedModelPayload = useMemo<ModelPayload | undefined>(() => {
    if (!selectedModel) {
      return undefined;
    }
    const [providerID, ...modelParts] = selectedModel.split("/");
    const modelID = modelParts.join("/");
    if (!providerID || !modelID) {
      return undefined;
    }
    return { providerID, modelID };
  }, [selectedModel]);

  const sendPrompt = useCallback(async (input?: string | SendPromptInput) => {
    if (sendingPromptRef.current) {
      return;
    }
    if (!activeProjectDir || !activeSessionID) {
      options.setStatusLine("Select a workspace and session first");
      return;
    }

    const promptInput: SendPromptInput = typeof input === "string"
      ? { systemAddendum: input }
      : input ?? {};
    const text = (promptInput.textOverride ?? composer).trim();
    if (!text && composerAttachments.length === 0) {
      return;
    }
    const normalizedSystemAddendum = promptInput.systemAddendum?.trim() ?? "";
    const promptSource = promptInput.promptSource ?? "user";
    const toolsKey = promptInput.tools
      ? JSON.stringify(Object.entries(promptInput.tools).sort(([left], [right]) => left.localeCompare(right)))
      : "";
    const sendToken = `${activeProjectDir}:${activeSessionID}:${text}:${composerAttachments.map((item) => item.url).join(",")}:${normalizedSystemAddendum}:${promptSource}:${toolsKey}`;
    if (lastSendRef.current && lastSendRef.current.token === sendToken && Date.now() - lastSendRef.current.at < 6_000) {
      return;
    }
    lastSendRef.current = { token: sendToken, at: Date.now() };

    const capturedAttachments = [...composerAttachments];
    setComposer("");
    setComposerAttachments([]);

    const supportsSelectedAgent = options.selectedAgent ? options.availableAgentNames.has(options.selectedAgent) : false;
    const activeSession = options.sessions.find((item) => item.id === activeSessionID);
    const shouldAutoTitle = text.length > 0 && options.shouldAutoRenameSessionTitle(activeSession?.title);

    try {
      sendingPromptRef.current = true;
      setIsSendingPrompt(true);
      options.setStatusLine("Sending prompt...");
      options.stopResponsePolling();
      if (shouldAutoTitle) {
        const generatedTitle = options.deriveSessionTitleFromPrompt(text);
        await window.orxa.opencode.renameSession(activeProjectDir, activeSessionID, generatedTitle);
        await options.refreshProject(activeProjectDir);
      }

      await window.orxa.opencode.sendPrompt({
        directory: activeProjectDir,
        sessionID: activeSessionID,
        text,
        system: normalizedSystemAddendum.length > 0 ? normalizedSystemAddendum : undefined,
        promptSource,
        tools: promptInput.tools,
        attachments: capturedAttachments.map((attachment) => ({
          url: attachment.url,
          mime: attachment.mime,
          filename: attachment.filename,
        })),
        agent: supportsSelectedAgent ? options.selectedAgent : undefined,
        model: selectedModelPayload,
        variant: selectedVariant,
      });

      options.clearPendingSession();
      options.setStatusLine(shouldAutoTitle ? "Prompt sent and session titled" : "Prompt sent");
      void options.refreshMessages();
      if (shouldAutoTitle) {
        void options.refreshProject(activeProjectDir).catch(() => undefined);
      }
    } catch (error) {
      setComposer(text);
      setComposerAttachments(capturedAttachments);
      options.setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      sendingPromptRef.current = false;
      setIsSendingPrompt(false);
    }
  }, [
    activeProjectDir,
    activeSessionID,
    composer,
    composerAttachments,
    options,
    setComposer,
    selectedVariant,
    selectedModelPayload,
  ]);

  const abortActiveSession = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return;
    }
    try {
      options.onSessionAbortRequested?.(activeProjectDir, activeSessionID);
      await window.orxa.opencode.abortSession(activeProjectDir, activeSessionID);
      options.setStatusLine("Stopping session...");
      void options.refreshProject(activeProjectDir).catch(() => undefined);
      void options.refreshMessages().catch(() => undefined);
    } catch (error) {
      options.setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID, options]);

  return {
    composer,
    setComposer,
    composerAttachments,
    isSendingPrompt,
    setComposerAttachments,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    selectedModelPayload,
    slashMenuOpen,
    setSlashMenuOpen,
    slashQuery,
    filteredSlashCommands,
    slashSelectedIndex,
    setSlashSelectedIndex,
    handleComposerChange,
    insertSlashCommand,
    handleSlashKeyDown,
    addComposerAttachments,
    pickImageAttachment,
    removeAttachment,
    sendPrompt,
    abortActiveSession,
  };
}
