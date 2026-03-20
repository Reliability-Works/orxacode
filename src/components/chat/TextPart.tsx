import { useCallback } from "react";
import { renderMarkdownText } from "../../lib/markdown";
import { CopyButton } from "./CopyButton";

interface TextPartProps {
  content: string;
  showCopy?: boolean;
  role?: "user" | "assistant";
  onOpenFileReference?: (reference: string) => void;
}

export function TextPart({ content, showCopy, role, onOpenFileReference }: TextPartProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest<HTMLElement>("[data-orxa-file-ref]");
      const reference = link?.dataset.orxaFileRef;
      if (!reference || !onOpenFileReference) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenFileReference(reference);
    },
    [onOpenFileReference],
  );

  return (
    <div className={`text-part${role ? ` text-part--${role}` : ""}`}>
      <div
        className="text-part-body part-text part-text-md"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderMarkdownText(content) }}
      />
      {showCopy ? <CopyButton text={content} className="text-part-copy" /> : null}
    </div>
  );
}
