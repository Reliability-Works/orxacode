import { useEffect, useState } from "react";

export function useAttachmentPreview<T>() {
  const [previewAttachment, setPreviewAttachment] = useState<T | null>(null);

  useEffect(() => {
    if (!previewAttachment) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPreviewAttachment(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [previewAttachment]);

  return {
    previewAttachment,
    setPreviewAttachment,
    clearPreviewAttachment: () => setPreviewAttachment(null),
  };
}
