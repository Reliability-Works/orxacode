import { useCallback, useEffect, useRef, useState } from "react";

export type TextInputDialogProps = {
  isOpen: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | null;
};

export function TextInputDialog({
  isOpen,
  title,
  placeholder,
  defaultValue = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  validate,
}: TextInputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValue(defaultValue);
    setError(null);
  }, [defaultValue, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen]);

  const submit = useCallback(() => {
    const nextError = validate ? validate(value) : null;
    if (nextError) {
      setError(nextError);
      return;
    }
    onConfirm(value);
  }, [onConfirm, validate, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onCancel, submit]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <section className="modal text-input-dialog" role="dialog" aria-modal="true" aria-labelledby="text-input-dialog-title" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2 id="text-input-dialog-title">{title}</h2>
        </header>
        <div className="text-input-dialog-body">
          <label className="text-input-dialog-field">
            <span>Value</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
            />
          </label>
          {error ? <p className="text-input-dialog-error">{error}</p> : null}
          <div className="text-input-dialog-actions">
            <button type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="primary" onClick={submit}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
