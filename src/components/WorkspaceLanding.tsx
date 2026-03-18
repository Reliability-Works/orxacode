import { useState, type ReactNode } from "react";
import type { SessionType } from "../types/canvas";
import { OpenCodeLogo, OpenAILogo, AnthropicLogo, CanvasLogo } from "./ProviderLogos";

type WorkspaceLandingProps = {
  workspaceName: string;
  onPickSession: (type: SessionType) => void;
};

const SESSION_OPTIONS: Array<{
  type: SessionType;
  title: string;
  subtitle: string;
  logo: ReactNode;
  accentClass: string;
}> = [
  {
    type: "standalone",
    title: "OpenCode",
    subtitle: "AI coding agent powered by any model provider",
    logo: <OpenCodeLogo size={26} />,
    accentClass: "landing-card--opencode",
  },
  {
    type: "codex",
    title: "Codex",
    subtitle: "OpenAI's autonomous coding agent",
    logo: <OpenAILogo size={26} />,
    accentClass: "landing-card--codex",
  },
  {
    type: "claude",
    title: "Claude Code",
    subtitle: "Anthropic's AI coding assistant",
    logo: <AnthropicLogo size={26} />,
    accentClass: "landing-card--claude",
  },
  {
    type: "canvas",
    title: "Canvas",
    subtitle: "Free-form tiled workspace with multiple views",
    logo: <CanvasLogo size={26} />,
    accentClass: "landing-card--canvas",
  },
];

export function WorkspaceLanding({ workspaceName, onPickSession }: WorkspaceLandingProps) {
  const [hoveredType, setHoveredType] = useState<SessionType | null>(null);

  return (
    <div className="workspace-landing">
      <div className="workspace-landing-header">
        <h2 className="workspace-landing-title">{workspaceName}</h2>
        <p className="workspace-landing-subtitle">choose a session type to get started</p>
      </div>

      <div className="workspace-landing-cards">
        {SESSION_OPTIONS.map((opt) => {
          const isHovered = hoveredType === opt.type;
          const isInactive = hoveredType !== null && !isHovered;
          return (
            <button
              key={opt.type}
              type="button"
              className={`workspace-landing-card ${opt.accentClass}${isHovered ? " is-hovered" : ""}${isInactive ? " is-inactive" : ""}`}
              onClick={() => onPickSession(opt.type)}
              onMouseEnter={() => setHoveredType(opt.type)}
              onMouseLeave={() => setHoveredType(null)}
            >
              <span className="landing-card-icon">{opt.logo}</span>
              <span className="landing-card-title">{opt.title}</span>
              <span className="landing-card-subtitle">{opt.subtitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
