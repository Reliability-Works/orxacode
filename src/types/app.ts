export type PermissionMode = "ask-write" | "yolo-write";

export type AppPreferences = {
  showOperationsPane: boolean;
  autoOpenTerminalOnCreate: boolean;
  confirmDangerousActions: boolean;
  permissionMode: PermissionMode;
  commitGuidancePrompt: string;
  codeFont: string;
  hiddenModels: string[];
  codexPath: string;
  codexArgs: string;
  codexDefaultModel: string;
  codexReasoningEffort: string;
  codexAccessMode: string;
  gitAgent: "opencode" | "claude" | "codex";
};

export type CodeFontOption = {
  label: string;
  value: string;
  stack: string;
};

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
