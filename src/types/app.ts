export type PermissionMode = "ask-write" | "yolo-write";

export type ThemeId = "glass" | "terminal" | "midnight" | "ember" | "arctic";

export type AppPreferences = {
  showOperationsPane: boolean;
  autoOpenTerminalOnCreate: boolean;
  confirmDangerousActions: boolean;
  permissionMode: PermissionMode;
  commitGuidancePrompt: string;
  codeFont: string;
  theme: ThemeId;
  uiFont: string;
  hiddenModels: string[];
  codexPath: string;
  codexArgs: string;
  codexDefaultModel: string;
  codexReasoningEffort: string;
  codexAccessMode: string;
  gitAgent: "opencode" | "claude" | "codex";
  notifyOnAwaitingInput: boolean;
  notifyOnTaskComplete: boolean;
  collaborationModesEnabled: boolean;
  subagentSystemNotificationsEnabled: boolean;
};

export type CodeFontOption = {
  label: string;
  value: string;
  stack: string;
};

export type UiFontOption = {
  label: string;
  value: string;
  stack: string;
};

export const UI_FONT_OPTIONS: UiFontOption[] = [
  { label: "Inter", value: "Inter", stack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  { label: "System", value: "System", stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  { label: "DM Sans", value: "DM Sans", stack: '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: "IBM Plex Sans", value: "IBM Plex Sans", stack: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif' },
];

export const CODE_FONT_OPTIONS: CodeFontOption[] = [
  { label: "IBM Plex Mono", value: "IBM Plex Mono", stack: '"IBM Plex Mono", monospace' },
  { label: "Fira Code", value: "Fira Code", stack: '"Fira Code", monospace' },
  { label: "JetBrains Mono", value: "JetBrains Mono", stack: '"JetBrains Mono", monospace' },
  { label: "Source Code Pro", value: "Source Code Pro", stack: '"Source Code Pro", monospace' },
  { label: "Anonymous Pro", value: "Anonymous Pro", stack: '"Anonymous Pro", monospace' },
  { label: "Cascadia Code", value: "Cascadia Code", stack: '"Cascadia Code", monospace' },
  { label: "Hack", value: "Hack", stack: '"Hack", monospace' },
  { label: "Inconsolata", value: "Inconsolata", stack: '"Inconsolata", monospace' },
  { label: "Space Mono", value: "Space Mono", stack: '"Space Mono", monospace' },
  { label: "Roboto Mono", value: "Roboto Mono", stack: '"Roboto Mono", monospace' },
];
