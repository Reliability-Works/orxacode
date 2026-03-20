import { useEffect, type RefObject } from "react";

export function useDismissibleLayer(
  open: boolean,
  layerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (layerRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [layerRef, onDismiss, open]);
}
