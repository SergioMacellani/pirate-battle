import mapDefinition from "./mapLayouts.json" with { type: "json" };
import type { Vector2 } from "../model/gameTypes";

export interface MapTileRules {
  water: number;
  shoreline: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
  };
  island: {
    interior: number[];
    random: number[];
    sand: number[];
    isolated: {
      horizontal: number;
      top: number;
      vertical: number;
      bottom: number;
      right: number;
      left: number;
    };
    thinCorridorCorner: {
      topLeft: number;
      topRight: number;
      bottomLeft: number;
      bottomRight: number;
    };
    grassTransition: {
      top: number[];
      right: number[];
      bottom: number[];
      left: number[];
      topLeft: number[];
      topRight: number[];
      bottomLeft: number[];
      bottomRight: number[];
    };
    innerCornerTransition: {
      topLeft: number[];
      topRight: number[];
      bottomLeft: number[];
      bottomRight: number[];
    };
    structures: Array<{
      center: number;
      detail: number;
      vertical: number;
      horizontal: number;
      endTop: number;
      endBottom: number;
      endLeft: number;
      endRight: number;
    }>;
  };
}

export type IslandShape =
  | "organic"
  | "chunky"
  | "ellipse"
  | "crescent"
  | "diamond"
  | "cross";

export interface IslandSlot {
  x: number;
  y: number;
}

export interface IslandSizeRange {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface IslandCountRange {
  min: number;
  max: number;
}

export interface MapDefinition {
  tileSize: number;
  tiles: MapTileRules;
  islandSlots: IslandSlot[];
  islandShapes: IslandShape[];
  islandSize: IslandSizeRange;
  islandCount: IslandCountRange;
}

export interface GeneratedIsland {
  id: string;
  origin: Vector2;
  width: number;
  height: number;
  cells: boolean[][];
  structures: boolean[][];
}

export interface GeneratedMap {
  tileSize: number;
  tiles: MapTileRules;
  islands: GeneratedIsland[];
}

const definition = mapDefinition as MapDefinition;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/** Smooth seeded radial contour, avoids the noisy per-cell look of raw randomness. */
function createContour(
  random: () => number,
  harmonics: number,
  amplitude: number,
  base: number,
): (angle: number) => number {
  const waves = Array.from({ length: harmonics }, () => ({
    frequency: 1 + Math.floor(random() * 3),
    phase: random() * Math.PI * 2,
    amplitude: (random() - 0.5) * amplitude,
  }));

  return (angle: number) =>
    base +
    waves.reduce(
      (sum, wave) => sum + wave.amplitude * Math.sin(angle * wave.frequency + wave.phase),
      0,
    );
}

function isOccupied(
  shape: IslandShape,
  normalizedX: number,
  normalizedY: number,
  contour: (angle: number) => number,
): boolean {
  const distance = Math.hypot(normalizedX * 1.8, normalizedY * 1.8);

  switch (shape) {
    case "ellipse":
      return distance < 0.92;
    case "crescent": {
      const cut = Math.hypot((normalizedX - 0.22) * 1.9, (normalizedY - 0.05) * 1.9);
      return distance < 0.95 && cut > 0.78;
    }
    case "diamond":
      return Math.abs(normalizedX) + Math.abs(normalizedY) < 0.66;
    case "cross": {
      const armWidth = 0.24;
      return (
        (Math.abs(normalizedX) < armWidth || Math.abs(normalizedY) < armWidth) &&
        distance < 1
      );
    }
    case "chunky":
    case "organic":
    default:
      return distance < contour(Math.atan2(normalizedY, normalizedX));
  }
}

function createIsland(
  id: string,
  origin: Vector2,
  width: number,
  height: number,
  shape: IslandShape,
  random: () => number,
): GeneratedIsland {
  const harmonics = shape === "chunky" ? 4 : 3;
  const amplitude = shape === "chunky" ? 0.3 : 0.16;
  const contour = createContour(random, harmonics, amplitude, 0.92);

  const cells = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) => {
      const normalizedX = (column + 0.5) / width - 0.5;
      const normalizedY = (row + 0.5) / height - 0.5;
      return isOccupied(shape, normalizedX, normalizedY, contour);
    }),
  );

  fillInteriorHoles(cells);

  const structureCandidates: Array<[number, number]> = [];
  cells.forEach((row, rowIndex) => {
    row.forEach((occupied, columnIndex) => {
      if (
        occupied &&
        cells[rowIndex - 1]?.[columnIndex] &&
        cells[rowIndex + 1]?.[columnIndex] &&
        cells[rowIndex]?.[columnIndex - 1] &&
        cells[rowIndex]?.[columnIndex + 1]
      ) {
        structureCandidates.push([rowIndex, columnIndex]);
      }
    });
  });

  const structures = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  const horizontalRuns = structureCandidates.reduce<Array<Array<[number, number]>>>(
    (runs, candidate) => {
      const previousRun = runs[runs.length - 1];
      if (previousRun?.[0]?.[0] === candidate[0] && previousRun.at(-1)![1] + 1 === candidate[1]) {
        previousRun.push(candidate);
      } else {
        runs.push([candidate]);
      }
      return runs;
    },
  []);
  const candidateKeys = new Set(
    structureCandidates.map(([rowIndex, columnIndex]) => `${rowIndex}:${columnIndex}`),
  );
  const verticalRuns: Array<Array<[number, number]>> = [];
  for (const [rowIndex, columnIndex] of structureCandidates) {
    if (candidateKeys.has(`${rowIndex - 1}:${columnIndex}`)) {
      continue;
    }
    const run: Array<[number, number]> = [];
    for (
      let currentRow = rowIndex;
      candidateKeys.has(`${currentRow}:${columnIndex}`);
      currentRow += 1
    ) {
      run.push([currentRow, columnIndex]);
    }
    verticalRuns.push(run);
  }
  const viableRuns = [...horizontalRuns, ...verticalRuns].filter((run) => run.length >= 2);
  const selectedRun = shuffle(viableRuns, random)[0];

  if (selectedRun) {
    const structureCount = Math.min(
      selectedRun.length,
      2 + Math.floor(random() * 3),
    );
    const start = Math.floor(random() * (selectedRun.length - structureCount + 1));
    for (const [rowIndex, columnIndex] of selectedRun.slice(start, start + structureCount)) {
      structures[rowIndex][columnIndex] = true;
    }
  }

  return { id, origin, width, height, cells, structures };
}

function fillInteriorHoles(cells: boolean[][]): void {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const connectedToWater = new Set<string>();
  const queue: Array<[number, number]> = [];

  const enqueueIfWater = (row: number, column: number): void => {
    if (
      row < 0 ||
      row >= height ||
      column < 0 ||
      column >= width ||
      cells[row][column]
    ) {
      return;
    }

    const key = `${row}:${column}`;
    if (connectedToWater.has(key)) {
      return;
    }
    connectedToWater.add(key);
    queue.push([row, column]);
  };

  for (let column = 0; column < width; column += 1) {
    enqueueIfWater(0, column);
    enqueueIfWater(height - 1, column);
  }
  for (let row = 0; row < height; row += 1) {
    enqueueIfWater(row, 0);
    enqueueIfWater(row, width - 1);
  }

  while (queue.length > 0) {
    const [row, column] = queue.shift()!;
    enqueueIfWater(row - 1, column);
    enqueueIfWater(row + 1, column);
    enqueueIfWater(row, column - 1);
    enqueueIfWater(row, column + 1);
  }

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const key = `${row}:${column}`;
      if (!cells[row][column] && !connectedToWater.has(key)) {
        cells[row][column] = true;
      }
    }
  }
}

function getIslandCellCenters(
  island: GeneratedIsland,
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): Array<{ x: number; y: number }> {
  const originX = arenaWidth * island.origin.x - (island.width * tileSize) / 2;
  const originY = arenaHeight * island.origin.y - (island.height * tileSize) / 2;
  const centers: Array<{ x: number; y: number }> = [];

  island.cells.forEach((row, rowIndex) => {
    row.forEach((occupied, columnIndex) => {
      if (!occupied) {
        return;
      }

      centers.push({
        x: originX + columnIndex * tileSize + tileSize / 2,
        y: originY + rowIndex * tileSize + tileSize / 2,
      });
    });
  });

  return centers;
}

function getIslandCenter(
  island: GeneratedIsland,
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): { x: number; y: number } {
  const occupiedPoints = getIslandCellCenters(island, tileSize, arenaWidth, arenaHeight);
  if (occupiedPoints.length === 0) {
    return {
      x: island.origin.x * arenaWidth,
      y: island.origin.y * arenaHeight,
    };
  }

  const sum = occupiedPoints.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / occupiedPoints.length,
    y: sum.y / occupiedPoints.length,
  };
}

function getIslandRadius(
  island: GeneratedIsland,
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): number {
  const center = getIslandCenter(island, tileSize, arenaWidth, arenaHeight);
  const occupiedPoints = getIslandCellCenters(island, tileSize, arenaWidth, arenaHeight);

  if (occupiedPoints.length === 0) {
    return tileSize * 0.5;
  }

  return Math.max(
    ...occupiedPoints.map((point) => Math.hypot(point.x - center.x, point.y - center.y)),
  );
}

function isInsidePlayerSafeZone(
  island: GeneratedIsland,
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): boolean {
  const safeCenterX = arenaWidth / 2;
  const safeCenterY = arenaHeight / 2;
  const safeRadius = 160;

  return getIslandCellCenters(island, tileSize, arenaWidth, arenaHeight).some((point) => {
    const distance = Math.hypot(point.x - safeCenterX, point.y - safeCenterY);
    return distance <= safeRadius;
  });
}

function areIslandsTooClose(
  first: GeneratedIsland,
  second: GeneratedIsland,
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): boolean {
  const minGap = 160;
  const firstCenter = getIslandCenter(first, tileSize, arenaWidth, arenaHeight);
  const secondCenter = getIslandCenter(second, tileSize, arenaWidth, arenaHeight);
  const firstRadius = getIslandRadius(first, tileSize, arenaWidth, arenaHeight);
  const secondRadius = getIslandRadius(second, tileSize, arenaWidth, arenaHeight);
  const distance = Math.hypot(firstCenter.x - secondCenter.x, firstCenter.y - secondCenter.y);

  return distance < minGap + firstRadius + secondRadius;
}

function isIslandPlacementValid(
  islands: GeneratedIsland[],
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): boolean {
  for (let index = 0; index < islands.length; index += 1) {
    if (isInsidePlayerSafeZone(islands[index], tileSize, arenaWidth, arenaHeight)) {
      return false;
    }

    for (let compareIndex = index + 1; compareIndex < islands.length; compareIndex += 1) {
      if (areIslandsTooClose(islands[index], islands[compareIndex], tileSize, arenaWidth, arenaHeight)) {
        return false;
      }
    }
  }

  return true;
}

function getValidIslandSlots(arenaWidth: number, arenaHeight: number): IslandSlot[] {
  const safeCenterX = arenaWidth / 2;
  const safeCenterY = arenaHeight / 2;
  const safeRadius = 170;

  return definition.islandSlots.filter((slot) => {
    const slotCenterX = slot.x * arenaWidth;
    const slotCenterY = slot.y * arenaHeight;
    const distance = Math.hypot(slotCenterX - safeCenterX, slotCenterY - safeCenterY);
    return distance > safeRadius;
  });
}

function canPlaceIsland(
  island: GeneratedIsland,
  existingIslands: GeneratedIsland[],
  tileSize: number,
  arenaWidth: number,
  arenaHeight: number,
): boolean {
  if (isInsidePlayerSafeZone(island, tileSize, arenaWidth, arenaHeight)) {
    return false;
  }

  return !existingIslands.some((otherIsland) =>
    areIslandsTooClose(island, otherIsland, tileSize, arenaWidth, arenaHeight),
  );
}

function generateIslandCandidate(
  slot: IslandSlot,
  random: () => number,
  islandOrdinal: number,
): GeneratedIsland {
  const shape =
    definition.islandShapes[Math.floor(random() * definition.islandShapes.length)];
  const { minWidth, maxWidth, minHeight, maxHeight } = definition.islandSize;
  const width = minWidth + Math.floor(random() * (maxWidth - minWidth + 1));
  const height = minHeight + Math.floor(random() * (maxHeight - minHeight + 1));

  return createIsland(
    `island-${islandOrdinal}`,
    { x: slot.x, y: slot.y },
    width,
    height,
    shape,
    random,
  );
}

function buildIslandsForAttempt(
  random: () => number,
  slots: IslandSlot[],
  targetCount: number,
  attemptNumber: number,
  arenaWidth: number,
  arenaHeight: number,
): GeneratedIsland[] {
  const islands: GeneratedIsland[] = [];

  for (let index = 0; index < slots.length && islands.length < targetCount; index += 1) {
    const slot = slots[index];

    for (let candidateAttempt = 0; candidateAttempt < 4; candidateAttempt += 1) {
      const candidate = generateIslandCandidate(
        slot,
        random,
        attemptNumber * 10000 + index * 100 + candidateAttempt,
      );

      if (!canPlaceIsland(candidate, islands, definition.tileSize, arenaWidth, arenaHeight)) {
        continue;
      }

      islands.push(candidate);
      break;
    }
  }

  return islands;
}

/** A new seed reshuffles island count, slots, shapes and sizes for a fresh map. */
export function generateMap(seed: number): GeneratedMap {
  const arenaWidth = 800;
  const arenaHeight = 600;
  const maxAttempts = 30;

  const fallbackSlots = definition.islandSlots;
  const validSlots = getValidIslandSlots(arenaWidth, arenaHeight);
  const minimumIslandCount = Math.max(2, definition.islandCount.min);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const random = seededRandom(seed + attempt * 9973 + 31);
    const slots = shuffle(validSlots.length >= minimumIslandCount ? validSlots : fallbackSlots, random);
    const { max } = definition.islandCount;
    const targetCount = Math.min(
      slots.length,
      Math.max(minimumIslandCount, minimumIslandCount + Math.floor(random() * (max - minimumIslandCount + 1))),
    );
    const islands = buildIslandsForAttempt(
      random,
      slots,
      targetCount,
      attempt,
      arenaWidth,
      arenaHeight,
    );

    if (islands.length >= minimumIslandCount && isIslandPlacementValid(islands, definition.tileSize, arenaWidth, arenaHeight)) {
      return {
        tileSize: definition.tileSize,
        tiles: definition.tiles,
        islands,
      };
    }
  }

  const fallbackRandom = seededRandom(seed + 99999);
  const fallbackOrderedSlots = shuffle(validSlots.length > 0 ? validSlots : fallbackSlots, fallbackRandom);
  const fallbackIslands: GeneratedIsland[] = [];

  for (let index = 0; index < fallbackOrderedSlots.length; index += 1) {
    const slot = fallbackOrderedSlots[index];
    const candidate = generateIslandCandidate(
      slot,
      fallbackRandom,
      9000 + index,
    );

    if (!canPlaceIsland(candidate, fallbackIslands, definition.tileSize, arenaWidth, arenaHeight)) {
      continue;
    }

    fallbackIslands.push(candidate);
    if (fallbackIslands.length >= minimumIslandCount) {
      break;
    }
  }

  if (fallbackIslands.length < minimumIslandCount) {
    const fallbackSlot = fallbackOrderedSlots[0];
    const fallbackCandidate = generateIslandCandidate(fallbackSlot, fallbackRandom, 99999);

    if (!canPlaceIsland(fallbackCandidate, fallbackIslands, definition.tileSize, arenaWidth, arenaHeight)) {
      return {
        tileSize: definition.tileSize,
        tiles: definition.tiles,
        islands: fallbackIslands,
      };
    }

    fallbackIslands.push(fallbackCandidate);
  }

  return {
    tileSize: definition.tileSize,
    tiles: definition.tiles,
    islands: fallbackIslands.filter(
      (island) => !isInsidePlayerSafeZone(island, definition.tileSize, arenaWidth, arenaHeight),
    ),
  };
}

export function getIslandCollisionRects(
  map: GeneratedMap,
  arenaWidth: number,
  arenaHeight: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const island of map.islands) {
    const originX = arenaWidth * island.origin.x - (island.width * map.tileSize) / 2;
    const originY = arenaHeight * island.origin.y - (island.height * map.tileSize) / 2;

    island.cells.forEach((row, rowIndex) => {
      row.forEach((occupied, columnIndex) => {
        if (!occupied) {
          return;
        }
        rects.push({
          x: originX + columnIndex * map.tileSize,
          y: originY + rowIndex * map.tileSize,
          width: map.tileSize,
          height: map.tileSize,
        });
      });
    });
  }

  return rects;
}

export function getStructureCollisionRects(
  map: GeneratedMap,
  arenaWidth: number,
  arenaHeight: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const island of map.islands) {
    const originX = arenaWidth * island.origin.x - (island.width * map.tileSize) / 2;
    const originY = arenaHeight * island.origin.y - (island.height * map.tileSize) / 2;

    island.structures.forEach((row, rowIndex) => {
      row.forEach((hasStructure, columnIndex) => {
        if (!hasStructure) {
          return;
        }
        rects.push({
          x: originX + columnIndex * map.tileSize,
          y: originY + rowIndex * map.tileSize,
          width: map.tileSize,
          height: map.tileSize,
        });
      });
    });
  }

  return rects;
}

