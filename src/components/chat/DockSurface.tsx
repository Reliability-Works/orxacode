import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DockSurfaceProps {
  title?: string;
  icon?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function DockSurface({ title, icon, onClose, children, footer }: DockSurfaceProps) {
  return (
    <div className="dock-surface">
      {(title !== undefined || icon !== undefined || onClose !== undefined) && (
        <div className="dock-surface-header">
          {icon ? <span className="dock-surface-icon" aria-hidden="true">{icon}</span> : null}
          {title ? <span className="dock-surface-title">{title}</span> : null}
          {onClose ? (
            <button
              type="button"
              className="dock-surface-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
      <div className="dock-surface-body">
        {children}
      </div>
      {footer ? (
        <div className="dock-surface-footer">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export type { DockSurfaceProps };
