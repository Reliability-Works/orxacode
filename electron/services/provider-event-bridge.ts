import type { OrxaEvent } from "../../shared/ipc";
import type { ClaudeChatService } from "./claude-chat-service";
import type { CodexService } from "./codex-service";

type ProviderEventBridgeDeps = {
  codexService: CodexService;
  claudeChatService: ClaudeChatService;
  publishEvent: (event: OrxaEvent) => void;
  trackCodexTokenUsage: (params: Record<string, unknown>) => void;
  trackCodexThread: () => void;
};

export function registerProviderEventBridge({
  codexService,
  claudeChatService,
  publishEvent,
  trackCodexTokenUsage,
  trackCodexThread,
}: ProviderEventBridgeDeps) {
  codexService.on("state", (payload: unknown) => {
    publishEvent({ type: "codex.state", payload } as OrxaEvent);
  });

  codexService.on("notification", (payload: unknown) => {
    publishEvent({ type: "codex.notification", payload } as OrxaEvent);
    const notification = payload as { method?: string; params?: Record<string, unknown> } | undefined;
    if (notification?.method === "thread/tokenUsage/updated" && notification.params) {
      trackCodexTokenUsage(notification.params);
    }
    if (notification?.method === "thread/started") {
      trackCodexThread();
    }
  });

  codexService.on("approval", (payload: unknown) => {
    publishEvent({ type: "codex.approval", payload } as OrxaEvent);
  });

  codexService.on("userInput", (payload: unknown) => {
    publishEvent({ type: "codex.userInput", payload } as OrxaEvent);
  });

  claudeChatService.on("state", (payload: unknown) => {
    publishEvent({ type: "claude-chat.state", payload } as OrxaEvent);
  });

  claudeChatService.on("notification", (payload: unknown) => {
    publishEvent({ type: "claude-chat.notification", payload } as OrxaEvent);
  });

  claudeChatService.on("approval", (payload: unknown) => {
    publishEvent({ type: "claude-chat.approval", payload } as OrxaEvent);
  });

  claudeChatService.on("userInput", (payload: unknown) => {
    publishEvent({ type: "claude-chat.userInput", payload } as OrxaEvent);
  });
}
