import { test, expect } from '@playwright/test';
import { generateMap } from '../src/game/map/mapGenerator';

const TILE_SIZE = 64;
const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 600;
const MIN_PLAYER_SAFE_RADIUS = 160;
const MIN_ISLAND_GAP = 110;

function getCenterCell(island: { origin: { x: number; y: number }; width: number; height: number }, row: number, column: number) {
  const originX = ARENA_WIDTH * island.origin.x - (island.width * TILE_SIZE) / 2;
  const originY = ARENA_HEIGHT * island.origin.y - (island.height * TILE_SIZE) / 2;
  return {
    x: originX + column * TILE_SIZE + TILE_SIZE / 2,
    y: originY + row * TILE_SIZE + TILE_SIZE / 2,
  };
}

test('map generation keeps islands apart and prevents island spawn inside player area', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const map = generateMap(seed);
    expect(map.islands.length).toBeGreaterThan(0);
    const safeCenter = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };

    for (let islandIndex = 0; islandIndex < map.islands.length; islandIndex += 1) {
      const island = map.islands[islandIndex];

      for (let row = 0; row < island.cells.length; row += 1) {
        for (let column = 0; column < island.cells[row].length; column += 1) {
          if (!island.cells[row][column]) {
            continue;
          }

          const cellCenter = getCenterCell(island, row, column);
          const distanceToPlayer = Math.hypot(
            cellCenter.x - safeCenter.x,
            cellCenter.y - safeCenter.y,
          );

          expect(
            distanceToPlayer,
            `Seed ${seed} generated an island inside the player safe zone.`,
          ).toBeGreaterThan(MIN_PLAYER_SAFE_RADIUS);
        }
      }

      for (let otherIndex = islandIndex + 1; otherIndex < map.islands.length; otherIndex += 1) {
        const otherIsland = map.islands[otherIndex];

        for (let row = 0; row < island.cells.length; row += 1) {
          for (let column = 0; column < island.cells[row].length; column += 1) {
            if (!island.cells[row][column]) {
              continue;
            }

            const firstCell = getCenterCell(island, row, column);

            for (let otherRow = 0; otherRow < otherIsland.cells.length; otherRow += 1) {
              for (let otherColumn = 0; otherColumn < otherIsland.cells[otherRow].length; otherColumn += 1) {
                if (!otherIsland.cells[otherRow][otherColumn]) {
                  continue;
                }

                const secondCell = getCenterCell(otherIsland, otherRow, otherColumn);
                const distance = Math.hypot(
                  firstCell.x - secondCell.x,
                  firstCell.y - secondCell.y,
                );

                expect(
                  distance,
                  `Seed ${seed} generated islands too close to each other.`,
                ).toBeGreaterThan(MIN_ISLAND_GAP);
              }
            }
          }
        }
      }
    }
  }
});
