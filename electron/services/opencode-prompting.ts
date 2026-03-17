import type { PromptRequest } from "../../shared/ipc";

export type PromptPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      mime: string;
      url: string;
      filename?: string;
    };

export function buildPromptDedupeKey(input: PromptRequest, normalizedDirectory: string) {
  return [
    normalizedDirectory,
    input.sessionID,
    input.text.trim(),
    input.contextModeEnabled ? "context:on" : "context:off",
    input.promptSource ?? "user",
    input.system?.trim() ?? "",
  ].join("::");
}

export function buildPromptParts(input: PromptRequest): PromptPart[] {
  const parts: PromptPart[] = [
    {
      type: "text",
      text: input.text,
    },
  ];

  for (const attachment of input.attachments ?? []) {
    if (!attachment.url || !attachment.mime) {
      continue;
    }
    parts.push({
      type: "file",
      mime: attachment.mime,
      url: attachment.url,
      filename: attachment.filename,
    });
  }

  return parts;
}

export function composeSystemPrompt(systemParts: Array<string | undefined>) {
  const systemPrompt = systemParts
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .join("\n\n");
  return systemPrompt.length > 0 ? systemPrompt : undefined;
}
