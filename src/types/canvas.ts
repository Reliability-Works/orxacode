export type SessionType = "standalone" | "canvas" | "codex" | "claude";

export interface CanvasTile {
  id: string;
  type: "terminal" | "browser" | "file_editor" | "dev_server" | "markdown_preview" | "image_viewer" | "api_tester";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  meta: Record<string, unknown>;
}

export interface CanvasTheme {
  preset: string | null;
  background: string;
  tileBorder: string;
  accent: string;
}

export interface CanvasSessionState {
  tiles: CanvasTile[];
  theme: CanvasTheme;
  snapToGrid: boolean;
  gridSize: number;
}
