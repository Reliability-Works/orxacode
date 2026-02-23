import { useRef, useState, useCallback, useEffect, type ButtonHTMLAttributes, type SVGProps } from "react";
import { createPortal } from "react-dom";

type IconName =
  | "profiles"
  | "settings"
  | "terminal"
  | "refresh"
  | "folderPlus"
  | "plus"
  | "send"
  | "image"
  | "search"
  | "sort"
  | "stop"
  | "git"
  | "files"
  | "diff"
  | "log"
  | "issues"
  | "pulls"
  | "panelLeft"
  | "panelRight"
  | "orxa"
  | "standard";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
};

function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  switch (name) {
    case "profiles":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="3.5" />
          <path d="M20 8v6" />
          <path d="M23 11h-6" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h.1a1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
      );
    case "terminal":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <path d="M13 15h4" />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case "folderPlus":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
          <path d="M12 10.5v5" />
          <path d="M9.5 13h5" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "send":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case "image":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m21 15-4.5-4.5L7 20" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "sort":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M5 7h10" />
          <path d="M5 12h8" />
          <path d="M5 17h6" />
          <path d="m16 8 2-2 2 2" />
          <path d="M18 6v12" />
          <path d="m16 16 2 2 2-2" />
        </svg>
      );
    case "stop":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
        </svg>
      );
    case "git":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="7" cy="6" r="2.2" />
          <circle cx="17" cy="12" r="2.2" />
          <circle cx="7" cy="18" r="2.2" />
          <path d="M8.9 7.3 15 10.7" />
          <path d="M8.9 16.7 15 13.3" />
        </svg>
      );
    case "files":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 20H6A2.5 2.5 0 0 1 3.5 17.5z" />
        </svg>
      );
    case "diff":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="7" cy="7" r="2" />
          <circle cx="17" cy="17" r="2" />
          <path d="M8.7 8.7 15.3 15.3" />
          <path d="M14 6h4v4" />
        </svg>
      );
    case "log":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M6 4v16" />
          <path d="M6 8h8" />
          <path d="M6 12h12" />
          <path d="M6 16h9" />
        </svg>
      );
    case "issues":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r="0.8" />
        </svg>
      );
    case "pulls":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="7" cy="5.5" r="2" />
          <circle cx="17" cy="8.5" r="2" />
          <circle cx="7" cy="18.5" r="2" />
          <path d="M7 7.5v9" />
          <path d="M9 16.5h3a5 5 0 0 0 5-5v-1" />
        </svg>
      );
    case "panelLeft":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M9 4v16" />
          <path d="m13.5 12 3-2.5v5z" />
        </svg>
      );
    case "panelRight":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M15 4v16" />
          <path d="m10.5 12-3-2.5v5z" />
        </svg>
      );
    case "orxa":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "standard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    default:
      return null;
  }
}

export function IconButton({ icon, label, className = "", type = "button", ...props }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        const above = r.top > 56;
        const centerX = r.left + r.width / 2;
        const clampedLeft = Math.max(130, Math.min(window.innerWidth - 130, centerX));
        setTooltip({
          left: clampedLeft,
          top: above ? r.top - 8 : r.bottom + 8,
          above,
        });
      }
    }, 1000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setTooltip(null);
  }, []);

  return (
    <>
      <button
        {...props}
        ref={btnRef}
        type={type}
        className={`icon-button ${className}`.trim()}
        aria-label={label}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Icon name={icon} width={18} height={18} aria-hidden="true" />
      </button>
      {tooltip
        ? createPortal(
            <div
              className="icon-btn-tooltip"
              style={{
                left: tooltip.left,
                top: tooltip.top,
                transform: tooltip.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
