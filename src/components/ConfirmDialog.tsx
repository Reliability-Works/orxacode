import { useEffect } from "react";

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2 id="confirm-dialog-title">{title}</h2>
        </header>
        <div className="confirm-dialog-body">
          <p>{message}</p>
          <div className="confirm-dialog-actions">
            <button type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className={variant === "danger" ? "danger" : "primary"} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
