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

type UseComposerStateOptions = {
  availableSlashCommands: SlashCommand[];
  refreshMessages: () => Promise<void>;
  refreshProject: (directory: string) => Promise<unknown>;
  sessions: ComposerSession[];
  selectedAgent?: string;
  serverAgentNames: Set<string>;
  setStatusLine: (status: string) => void;
  shouldAutoRenameSessionTitle: (title: string | undefined) => boolean;
  deriveSessionTitleFromPrompt: (prompt: string, maxLength?: number) => string;
  startResponsePolling: (directory: string, sessionID: string) => void;
  stopResponsePolling: () => void;
  clearPendingSession: () => void;
};

export function useComposerState(activeProjectDir: string | null, activeSessionID: string | null, options: UseComposerStateOptions) {
  const [composer, setComposer] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([]);
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
  }, []);

  const insertSlashCommand = useCallback((commandName: string) => {
    setComposer((prev) => {
      const lines = prev.split("\n");
      lines[lines.length - 1] = `/${commandName} `;
      return lines.join("\n");
    });
    setSlashMenuOpen(false);
    setSlashQuery("");
  }, []);

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

  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage();
      if (!selection) {
        return;
      }
      setComposerAttachments((current) => {
        if (current.some((item) => item.url === selection.url)) {
          return current;
        }
        return [...current, selection];
      });
    } catch (error) {
      options.setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [options]);

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

  const sendPrompt = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      options.setStatusLine("Select a workspace and session first");
      return;
    }

    const text = composer.trim();
    if (!text && composerAttachments.length === 0) {
      return;
    }

    const capturedAttachments = [...composerAttachments];
    setComposer("");
    setComposerAttachments([]);

    const supportsSelectedAgent = options.selectedAgent ? options.serverAgentNames.has(options.selectedAgent) : false;
    const activeSession = options.sessions.find((item) => item.id === activeSessionID);
    const shouldAutoTitle = text.length > 0 && options.shouldAutoRenameSessionTitle(activeSession?.title);

    try {
      options.stopResponsePolling();
      if (shouldAutoTitle) {
        const generatedTitle = options.deriveSessionTitleFromPrompt(text);
        await window.orxa.opencode.renameSession(activeProjectDir, activeSessionID, generatedTitle);
      }

      await window.orxa.opencode.sendPrompt({
        directory: activeProjectDir,
        sessionID: activeSessionID,
        text,
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
      window.setTimeout(() => {
        void options.refreshMessages();
      }, 240);
      options.startResponsePolling(activeProjectDir, activeSessionID);
      if (shouldAutoTitle) {
        void options.refreshProject(activeProjectDir).catch(() => undefined);
      }
    } catch (error) {
      setComposer(text);
      setComposerAttachments(capturedAttachments);
      options.setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [
    activeProjectDir,
    activeSessionID,
    composer,
    composerAttachments,
    options,
    selectedVariant,
    selectedModelPayload,
  ]);

  const abortActiveSession = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return;
    }
    try {
      await window.orxa.opencode.abortSession(activeProjectDir, activeSessionID);
      options.setStatusLine("Stopped");
      options.stopResponsePolling();
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
    pickImageAttachment,
    removeAttachment,
    sendPrompt,
    abortActiveSession,
  };
}
