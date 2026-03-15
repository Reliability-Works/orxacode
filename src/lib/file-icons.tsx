import { BookOpen, Braces, FileCode2, FileText, Globe, Image, Lock, Palette, Settings, Terminal } from "lucide-react";
import type { ReactNode } from "react";

export type FileIconResult = {
  icon: ReactNode;
  color: string;
};

export function getFileIcon(filename: string): FileIconResult {
  // Match dotfiles by full name first (no extension)
  const lower = filename.toLowerCase();

  if (lower === ".gitignore" || lower === ".eslintrc" || lower === ".prettierrc") {
    return { icon: <Settings size={14} />, color: "#737373" };
  }

  if (lower === ".env" || lower === ".env.local" || lower.startsWith(".env.")) {
    return { icon: <Lock size={14} />, color: "#F59E0B" };
  }

  const dotIndex = lower.lastIndexOf(".");
  const ext = dotIndex >= 0 && dotIndex < lower.length - 1 ? lower.slice(dotIndex + 1) : "";

  switch (ext) {
    case "ts":
    case "tsx":
      return { icon: <FileCode2 size={14} />, color: "#3178C6" };

    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { icon: <FileCode2 size={14} />, color: "#F7DF1E" };

    case "css":
    case "scss":
    case "sass":
      return { icon: <Palette size={14} />, color: "#E34F26" };

    case "html":
      return { icon: <Globe size={14} />, color: "#E34F26" };

    case "json":
    case "jsonc":
      return { icon: <Braces size={14} />, color: "#A3A3A3" };

    case "md":
    case "mdx":
      return { icon: <BookOpen size={14} />, color: "#A3A3A3" };

    case "py":
      return { icon: <FileCode2 size={14} />, color: "#3776AB" };

    case "rs":
      return { icon: <FileCode2 size={14} />, color: "#DEA584" };

    case "go":
      return { icon: <FileCode2 size={14} />, color: "#00ADD8" };

    case "svg":
      return { icon: <Image size={14} />, color: "#FFB13B" };

    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
      return { icon: <Image size={14} />, color: "#A3A3A3" };

    case "yaml":
    case "yml":
    case "toml":
      return { icon: <FileText size={14} />, color: "#A3A3A3" };

    case "sh":
    case "bash":
    case "zsh":
      return { icon: <Terminal size={14} />, color: "#22C55E" };

    default:
      return { icon: <FileText size={14} />, color: "#737373" };
  }
}
