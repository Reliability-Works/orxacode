import {
  Eye,
  FileEdit,
  FolderOpen,
  Globe,
  ListTodo,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
const TOOL_ICON_RULES: Array<{ keywords: string[]; icon: "terminal" | "write" | "read" | "search" | "browser" | "list" | "todo" }> = [
  { keywords: ["bash", "shell", "terminal", "command", "ran ", "running "], icon: "terminal" },
  { keywords: ["write", "edit", "patch", "create", "wrote", "editing", "writing"], icon: "write" },
  { keywords: ["read", "view", "cat"], icon: "read" },
  { keywords: ["search", "grep", "find", "glob"], icon: "search" },
  { keywords: ["browser", "web", "navigate"], icon: "browser" },
  { keywords: ["list", "ls", "dir"], icon: "list" },
  { keywords: ["todo", "task", "plan"], icon: "todo" },
];

function resolveToolIcon(title: string) {
  const lower = title.toLowerCase();
  for (const rule of TOOL_ICON_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.icon;
    }
  }
  return "fallback" as const;
}

export function ToolTypeIcon({
  title,
  size = 13,
  className,
}: {
  title: string;
  size?: number;
  className?: string;
}) {
  const iconProps = { size, className, "aria-hidden": "true" as const };
  switch (resolveToolIcon(title)) {
    case "terminal":
      return <Terminal {...iconProps} />;
    case "write":
      return <FileEdit {...iconProps} />;
    case "read":
      return <Eye {...iconProps} />;
    case "search":
      return <Search {...iconProps} />;
    case "browser":
      return <Globe {...iconProps} />;
    case "list":
      return <FolderOpen {...iconProps} />;
    case "todo":
      return <ListTodo {...iconProps} />;
    default:
      return <Wrench {...iconProps} />;
  }
}
