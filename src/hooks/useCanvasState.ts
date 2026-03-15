import { useCallback } from "react";
import { usePersistedState } from "./usePersistedState";
import type { CanvasTile, CanvasTheme, CanvasSessionState } from "../types/canvas";

const DEFAULT_THEME: CanvasTheme = {
  preset: "midnight",
  background: "#0C0C0C",
  tileBorder: "#1F1F1F",
  accent: "#22C55E",
};

const DEFAULT_STATE: CanvasSessionState = {
  tiles: [],
  theme: DEFAULT_THEME,
  snapToGrid: false,
  gridSize: 20,
};

function makeCanvasStateKey(sessionId: string) {
  return `orxa:canvasState:${sessionId}:v1`;
}

export function useCanvasState(sessionId: string) {
  const [state, setState] = usePersistedState<CanvasSessionState>(
    makeCanvasStateKey(sessionId),
    DEFAULT_STATE,
  );

  const addTile = useCallback(
    (tile: Omit<CanvasTile, "zIndex">) => {
      setState((prev) => {
        const maxZ = prev.tiles.reduce((max, t) => Math.max(max, t.zIndex), 0);
        return {
          ...prev,
          tiles: [...prev.tiles, { ...tile, zIndex: maxZ + 1 }],
        };
      });
    },
    [setState],
  );

  const removeTile = useCallback(
    (tileId: string) => {
      setState((prev) => ({
        ...prev,
        tiles: prev.tiles.filter((t) => t.id !== tileId),
      }));
    },
    [setState],
  );

  const updateTile = useCallback(
    (tileId: string, updates: Partial<Omit<CanvasTile, "id">>) => {
      setState((prev) => ({
        ...prev,
        tiles: prev.tiles.map((t) => (t.id === tileId ? { ...t, ...updates } : t)),
      }));
    },
    [setState],
  );

  const bringToFront = useCallback(
    (tileId: string) => {
      setState((prev) => {
        const maxZ = prev.tiles.reduce((max, t) => Math.max(max, t.zIndex), 0);
        return {
          ...prev,
          tiles: prev.tiles.map((t) => (t.id === tileId ? { ...t, zIndex: maxZ + 1 } : t)),
        };
      });
    },
    [setState],
  );

  const setTheme = useCallback(
    (theme: Partial<CanvasTheme>) => {
      setState((prev) => ({
        ...prev,
        theme: { ...prev.theme, ...theme },
      }));
    },
    [setState],
  );

  const toggleSnap = useCallback(() => {
    setState((prev) => ({ ...prev, snapToGrid: !prev.snapToGrid }));
  }, [setState]);

  return {
    tiles: state.tiles,
    theme: state.theme,
    snapToGrid: state.snapToGrid,
    gridSize: state.gridSize,
    addTile,
    removeTile,
    updateTile,
    bringToFront,
    setTheme,
    toggleSnap,
  };
}
