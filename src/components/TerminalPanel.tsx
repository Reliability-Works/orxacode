import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { Plus, X } from "lucide-react";

export type TerminalTab = {
  id: string;
  label: string;
};

type TerminalInstance = {
  terminal: Terminal;
  fit: FitAddon;
  cleanups: Array<() => void>;
};

type Props = {
  directory: string;
  tabs: TerminalTab[];
  activeTabId: string | undefined;
  open: boolean;
  onCreateTab: () => Promise<void>;
  onCloseTab: (ptyId: string) => Promise<void>;
  onSwitchTab: (ptyId: string) => void;
};

const TERMINAL_THEME = {
  background: "#0d1117",
  foreground: "#d5e3f0",
  cursor: "#ffffff",
  black: "#041018",
  red: "#ff6f91",
  green: "#70f1b6",
  yellow: "#ffd97d",
  blue: "#8ec7ff",
  magenta: "#d4a5ff",
  cyan: "#8ce6ff",
  white: "#e9f1f7",
  brightBlack: "#4d6478",
  brightRed: "#ff8fad",
  brightGreen: "#9bffd4",
  brightYellow: "#ffe7a8",
  brightBlue: "#b6dbff",
  brightMagenta: "#e5c4ff",
  brightCyan: "#b6f4ff",
  brightWhite: "#ffffff",
};

export function TerminalPanel({ directory, tabs, activeTabId, open, onCreateTab, onCloseTab, onSwitchTab }: Props) {
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  const containerMapRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeTabId) return;

    const container = containerMapRef.current.get(activeTabId);
    if (!container) return;

    const existing = instancesRef.current.get(activeTabId);
    if (existing) {
      requestAnimationFrame(() => {
        existing.fit.fit();
        existing.terminal.focus();
      });
      return;
    }

    const terminal = new Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: true,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();

    const cleanups: Array<() => void> = [];

    // Connect first, then subscribe to PTY output AFTER connect resolves
    // to avoid the connect response (e.g. {"cursor":0}) leaking into the terminal display
    void window.orxa.terminal.connect(directory, activeTabId).then(() => {
      void window.orxa.terminal.resize(directory, activeTabId, terminal.cols, terminal.rows);

      const unsubscribe = window.orxa.events.subscribe((event) => {
        if (event.type === "pty.output" && event.payload.ptyID === activeTabId && event.payload.directory === directory) {
          terminal.write(event.payload.chunk);
        }
        if (event.type === "pty.closed" && event.payload.ptyID === activeTabId && event.payload.directory === directory) {
          terminal.writeln("\r\n\u001b[33m[terminal closed]\u001b[0m");
        }
      });
      cleanups.push(unsubscribe);
    });

    const disposeInput = terminal.onData((data) => {
      void window.orxa.terminal.write(directory, activeTabId, data);
    });
    cleanups.push(() => disposeInput.dispose());

    const resizeObs = new ResizeObserver(() => {
      fit.fit();
      void window.orxa.terminal.resize(directory, activeTabId, terminal.cols, terminal.rows);
    });
    resizeObs.observe(container);
    cleanups.push(() => resizeObs.disconnect());

    instancesRef.current.set(activeTabId, { terminal, fit, cleanups });

    requestAnimationFrame(() => terminal.focus());
  }, [open, activeTabId, directory]);

  useEffect(() => {
    const activeIds = new Set(tabs.map((t) => t.id));
    for (const [id, inst] of instancesRef.current.entries()) {
      if (!activeIds.has(id)) {
        for (const c of inst.cleanups) c();
        inst.terminal.dispose();
        instancesRef.current.delete(id);
      }
    }
  }, [tabs]);

  useEffect(() => {
    const instances = instancesRef.current;
    return () => {
      for (const inst of instances.values()) {
        for (const c of inst.cleanups) c();
        inst.terminal.dispose();
      }
      instances.clear();
    };
  }, []);

  return (
    <section className={`terminal-panel ${open ? "open" : "closed"}`}>
      <header className="terminal-header">
        <div className="terminal-tabs">
          <button
            type="button"
            className="terminal-tab-add"
            onClick={() => void onCreateTab()}
            aria-label="New terminal tab"
          >
            <Plus size={13} />
          </button>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`terminal-tab ${activeTabId === tab.id ? "active" : ""}`}
              onClick={() => onSwitchTab(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {hoveredTab === tab.id ? (
                <span
                  className="terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onCloseTab(tab.id);
                  }}
                  role="button"
                  tabIndex={-1}
                >
                  <X size={11} />
                </span>
              ) : (
                <span className="terminal-tab-label">{tab.label}</span>
              )}
            </button>
          ))}
          {tabs.length === 0 ? (
            <span className="terminal-empty-hint">Press + to create a terminal</span>
          ) : null}
        </div>
      </header>
      <div className="terminal-body-container">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-body-instance ${activeTabId === tab.id ? "active" : ""}`}
            ref={(el) => {
              if (el) containerMapRef.current.set(tab.id, el);
              else containerMapRef.current.delete(tab.id);
            }}
          />
        ))}
      </div>
    </section>
  );
}
