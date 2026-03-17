import { renderMarkdownText } from "../../lib/markdown";
import { CopyButton } from "./CopyButton";

interface TextPartProps {
  content: string;
  showCopy?: boolean;
  role?: "user" | "assistant";
}

export function TextPart({ content, showCopy, role }: TextPartProps) {
  return (
    <div className={`text-part${role ? ` text-part--${role}` : ""}`}>
      <div
        className="text-part-body part-text part-text-md"
        dangerouslySetInnerHTML={{ __html: renderMarkdownText(content) }}
      />
      {showCopy ? <CopyButton text={content} className="text-part-copy" /> : null}
    </div>
  );
}
