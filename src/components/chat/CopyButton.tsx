import { useState } from "react";
import { ChatCheckIcon, ChatClipboardIcon } from "./chat-icons";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed — silently ignore
    }
  };

  return (
    <button
      type="button"
      className={`copy-button${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <ChatCheckIcon /> : <ChatClipboardIcon />}
    </button>
  );
}
