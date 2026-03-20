import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { MessageHeader } from "./MessageHeader";

interface MessageCardFrameProps {
  role: "user" | "assistant";
  label: string;
  timestamp?: number;
  showHeader?: boolean;
  copyText?: string;
  copyLabel?: string;
  children: ReactNode;
}

export function MessageCardFrame({
  role,
  label,
  timestamp,
  showHeader = true,
  copyText,
  copyLabel,
  children,
}: MessageCardFrameProps) {
  return (
    <article className={`message-card message-${role}`}>
      {showHeader ? <MessageHeader role={role} label={label} timestamp={timestamp} /> : null}
      <div className="message-parts">{children}</div>
      {role === "user" && copyText ? <CopyButton text={copyText} className="message-copy-btn" label={copyLabel ?? "Copy"} /> : null}
    </article>
  );
}
