import type { CanvasTile } from "../types/canvas";

const GRID_ARRANGE_GAP = 32;

export type CanvasTileSortMode = "type" | "created";

function getCanvasTileCreatedAt(tile: CanvasTile, fallbackIndex: number) {
  const createdAt = tile.meta?.createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt)
    ? createdAt
    : fallbackIndex;
}

export function sortCanvasTilesForLayout(tiles: CanvasTile[], mode: CanvasTileSortMode) {
  return [...tiles].sort((left, right) => {
    if (mode === "type") {
      const typeCompare = left.type.localeCompare(right.type);
      if (typeCompare !== 0) {
        return typeCompare;
      }
    }

    const leftCreatedAt = getCanvasTileCreatedAt(left, left.zIndex);
    const rightCreatedAt = getCanvasTileCreatedAt(right, right.zIndex);
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left.zIndex - right.zIndex;
  });
}

export function arrangeCanvasTilesInGrid(
  tiles: CanvasTile[],
  startX: number,
  startY: number,
  availableWidth: number,
) {
  const nextTiles: CanvasTile[] = [];
  const rowWidthLimit = Math.max(640, availableWidth);
  let cursorX = startX;
  let cursorY = startY;
  let rowHeight = 0;

  for (const tile of tiles) {
    if (cursorX > startX && cursorX + tile.width > startX + rowWidthLimit) {
      cursorX = startX;
      cursorY += rowHeight + GRID_ARRANGE_GAP;
      rowHeight = 0;
    }

    nextTiles.push({
      ...tile,
      x: cursorX,
      y: cursorY,
    });

    cursorX += tile.width + GRID_ARRANGE_GAP;
    rowHeight = Math.max(rowHeight, tile.height);
  }

  return nextTiles;
}
