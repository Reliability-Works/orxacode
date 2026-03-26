import { Terminal, type ITerminalOptions } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { WebglAddon } from "xterm-addon-webgl";

const DATA_BUFFER_FLUSH_MS = 5;

export type ManagedTerminal = {
  terminal: Terminal;
  fit: FitAddon;
  refit: () => void;
  writeBuffered: (chunk: string) => void;
  dispose: () => void;
};

function applyTerminalFill(container: HTMLElement) {
  const screen = container.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) return;

  screen.style.transform = "";
  screen.style.transformOrigin = "top left";

  const baseWidth = screen.offsetWidth;
  const baseHeight = screen.offsetHeight;
  if (!baseWidth || !baseHeight) return;

  const availableWidth = container.clientWidth;
  const availableHeight = container.clientHeight;
  if (!availableWidth || !availableHeight) return;

  const scaleX = availableWidth / baseWidth;
  const scaleY = availableHeight / baseHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;

  screen.style.transform = `scale(${scaleX}, ${scaleY})`;
}

export function createManagedTerminal(
  container: HTMLElement,
  options: ITerminalOptions,
): ManagedTerminal {
  const terminal = new Terminal({
    allowProposedApi: true,
    ...options,
  });
  const fit = new FitAddon();
  const unicode11 = new Unicode11Addon();
  let webglAddon: WebglAddon | null = null;
  let dataBuffer: string[] = [];
  let flushTimer: number | undefined;

  const flushBufferedWrites = () => {
    const chunk = dataBuffer.join("");
    dataBuffer = [];
    flushTimer = undefined;
    if (chunk) {
      terminal.write(chunk);
    }
  };

  terminal.loadAddon(fit);
  terminal.open(container);
  terminal.loadAddon(unicode11);
  terminal.unicode.activeVersion = "11";

  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => webglAddon?.dispose());
    terminal.loadAddon(webglAddon);
  } catch {
    webglAddon = null;
  }

  const refit = () => {
    fit.fit();
    requestAnimationFrame(() => {
      applyTerminalFill(container);
    });
  };

  refit();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => refit());
  });

  return {
    terminal,
    fit,
    refit,
    writeBuffered: (chunk: string) => {
      dataBuffer.push(chunk);
      if (flushTimer === undefined) {
        flushTimer = window.setTimeout(flushBufferedWrites, DATA_BUFFER_FLUSH_MS);
      }
    },
    dispose: () => {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushBufferedWrites();
      }
      webglAddon?.dispose();
      terminal.dispose();
    },
  };
}
