import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DockSurfaceProps {
  title?: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function DockSurface({ title, icon, headerAction, onClose, children, footer, className, bodyClassName }: DockSurfaceProps) {
  return (
    <div className={`dock-surface ${className ?? ""}`.trim()}>
      <div className="dock-surface-panel">
        {(title !== undefined || icon !== undefined || headerAction !== undefined || onClose !== undefined) && (
          <div className="dock-surface-header">
            {icon ? <span className="dock-surface-icon" aria-hidden="true">{icon}</span> : null}
            {title ? <span className="dock-surface-title">{title}</span> : null}
            {headerAction}
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
        <div className={`dock-surface-body ${bodyClassName ?? ""}`.trim()}>
          {children}
        </div>
        {footer ? (
          <div className="dock-surface-footer">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type { DockSurfaceProps };
