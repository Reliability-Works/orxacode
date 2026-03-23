import { useEffect } from "react";

export type InfoDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  dismissLabel?: string;
  onDismiss: () => void;
};

export function InfoDialog({
  isOpen,
  title,
  message,
  dismissLabel = "Close",
  onDismiss,
}: InfoDialogProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onDismiss]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="overlay" onClick={onDismiss}>
      <section
        className="modal info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="info-dialog-title">{title}</h2>
        </header>
        <div className="info-dialog-body">
          <p>{message}</p>
          <div className="info-dialog-actions">
            <button type="button" className="primary" onClick={onDismiss}>
              {dismissLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
