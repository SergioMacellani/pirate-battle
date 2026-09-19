import {
  Assets,
  Container,
  BlurFilter,
  Graphics,
  Sprite,
  TilingSprite,
  Texture,
} from "pixi.js";
import {
  generateMap,
  getIslandCollisionRects,
  getStructureCollisionRects,
  type GeneratedMap,
} from "../map/mapGenerator";

const TILE_PATH = (tileId: number) =>
  `/assets/png/default/tiles/tile_${tileId}.png`;

/** Renders the same generated map that the simulation uses for collisions. */
export class MapRenderer {
  public readonly container = new Container();

  private readonly shadowLayer = new Container();
  private readonly waterLayer = new Container();
  private readonly waterSurface: TilingSprite;
  private readonly shorelineLayer = new Container();
  private readonly islandLayer = new Container();
  private readonly islandShadows = new Graphics();
  private readonly playerShadow = new Graphics();
  private constructor(
    private readonly textures: Map<number, Texture>,
    private readonly map: GeneratedMap,
  ) {
    this.waterSurface = new TilingSprite(
      textures.get(map.tiles.water) ?? Texture.WHITE,
    );
    this.waterLayer.addChild(this.waterSurface);
    // Keep the water mostly opaque while allowing the lower shadow layer to
    // remain subtly visible through the waves.
    this.waterLayer.alpha = 0.9;
    this.shadowLayer.filters = [new BlurFilter(5)];
    this.shadowLayer.addChild(this.islandShadows, this.playerShadow);
    this.container.addChild(
      this.shadowLayer,
      this.waterLayer,
      this.shorelineLayer,
      this.islandLayer,
    );
  }
  private width = 0;
  private height = 0;

  public static async create(
    width: number,
    height: number,
    seed: number,
  ): Promise<MapRenderer> {
    const map = generateMap(seed);
    const tileIds = new Set([
      map.tiles.water,
      ...Object.values(map.tiles.shoreline),
      ...map.tiles.island.interior,
      ...map.tiles.island.random,
      ...map.tiles.island.sand,
      ...Object.values(map.tiles.island.isolated),
      ...Object.values(map.tiles.island.thinCorridorCorner),
      ...Object.values(map.tiles.island.grassTransition).flat(),
      ...Object.values(map.tiles.island.innerCornerTransition).flat(),
      ...map.tiles.island.structures.flatMap((structure) => Object.values(structure)),
    ]);
    const entries = await Promise.all(
      [...tileIds].map(
        async (tileId) =>
          [tileId, await Assets.load<Texture>(TILE_PATH(tileId))] as const,
      ),
    );
    const renderer = new MapRenderer(new Map(entries), map);
    renderer.resize(width, height);
    return renderer;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.drawWaterLayer();
    this.drawIslandLayers();
  }

  public update(
    deltaSeconds: number,
    playerPosition: { x: number; y: number },
    playerRotation: number,
  ): void {
    // Move the water texture slightly to create a calm animated current.
    this.waterSurface.tilePosition.x -= deltaSeconds * 8;
    this.waterSurface.tilePosition.y += deltaSeconds * 5;
    this.updatePlayerShadow(
      playerPosition.x,
      playerPosition.y,
      playerRotation,
    );
  }

  public getCollisionRects(): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    return getIslandCollisionRects(this.map, this.width, this.height);
  }

  public getStructureCollisionRects(): Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    return getStructureCollisionRects(this.map, this.width, this.height);
  }

  private drawWaterLayer(): void {
    const waterTexture = this.textures.get(this.map.tiles.water);
    if (!waterTexture) {
      return;
    }
    this.waterSurface.texture = waterTexture;
    this.waterSurface.position.set(0, 0);
    this.waterSurface.width = this.width;
    this.waterSurface.height = this.height;
  }

  private drawIslandLayers(): void {
    this.clearLayer(this.shorelineLayer);
    this.clearLayer(this.islandLayer);
    this.islandShadows.clear();
    const renderedStructureCenters: Array<{ x: number; y: number }> = [];
    let renderedStructureGroup = false;

    for (const island of this.map.islands) {
      const originX =
        this.width * island.origin.x - (island.width * this.map.tileSize) / 2;
      const originY =
        this.height * island.origin.y - (island.height * this.map.tileSize) / 2;
      const structureCenters = island.structures.flatMap((row, rowIndex) =>
        row.flatMap((hasStructure, columnIndex) => hasStructure
          ? [{
            x: originX + columnIndex * this.map.tileSize + this.map.tileSize / 2,
            y: originY + rowIndex * this.map.tileSize + this.map.tileSize / 2,
          }]
          : []),
      );
      const structureOverlapsAnotherIsland = structureCenters.some((center) =>
        renderedStructureCenters.some((renderedCenter) =>
          Math.hypot(center.x - renderedCenter.x, center.y - renderedCenter.y) < this.map.tileSize * 1.5,
        ),
      );
      const renderIslandStructures = !renderedStructureGroup && !structureOverlapsAnotherIsland;
      if (renderIslandStructures) {
        renderedStructureCenters.push(...structureCenters);
        renderedStructureGroup = structureCenters.length > 0;
      }

      // Keep the projection aligned to the same tile grid as the island.
      this.islandShadows.beginFill(0xffffff, 0.2);
      island.cells.forEach((row, rowIndex) => {
        row.forEach((occupied, columnIndex) => {
          if (!occupied) {
            return;
          }

          this.islandShadows.drawRect(
            originX + columnIndex * this.map.tileSize + 8,
            originY + rowIndex * this.map.tileSize + 12,
            this.map.tileSize,
            this.map.tileSize,
          );

          const thinSandTile = this.getThinSandTile(island.cells, rowIndex, columnIndex);
          const thinCornerTile = this.getThinCorridorCornerTile(
            island.cells,
            rowIndex,
            columnIndex,
          );
          const shorelineBaseTile = this.getShorelineTileForCell(
            island.cells,
            rowIndex,
            columnIndex,
          );
          const corridorThickness = this.getCorridorThickness(
            island.cells,
            rowIndex,
            columnIndex,
          );
          const externalTransitionTile = shorelineBaseTile === undefined || corridorThickness === 2
            ? undefined
            : this.getGrassTransitionTileForBorder(island.cells, rowIndex, columnIndex);
          const shorelineTile = externalTransitionTile ?? shorelineBaseTile;
          const innerCornerTile = shorelineTile === undefined
            ? this.getInnerCornerTransitionTile(island.cells, rowIndex, columnIndex)
            : undefined;
          const isolated = !island.cells[rowIndex - 1]?.[columnIndex] &&
            !island.cells[rowIndex]?.[columnIndex + 1] &&
            !island.cells[rowIndex + 1]?.[columnIndex] &&
            !island.cells[rowIndex]?.[columnIndex - 1];
          const tileId = corridorThickness === 2
            ? thinCornerTile ?? shorelineTile ?? this.getSandTile(rowIndex, columnIndex)
            : thinSandTile ?? (isolated
              ? this.getIsolatedTile(rowIndex, columnIndex)
              : shorelineTile ?? innerCornerTile ?? this.getIslandTile(
              island.cells,
              rowIndex,
              columnIndex,
              undefined,
            ));
          const texture = this.textures.get(tileId);
          if (!texture) {
            return;
          }

          const layer = corridorThickness === 2 || thinCornerTile !== undefined || thinSandTile !== undefined || shorelineTile === undefined || isolated
            ? this.islandLayer
            : this.shorelineLayer;
          this.addTile(
            layer,
            texture,
            originX + columnIndex * this.map.tileSize,
            originY + rowIndex * this.map.tileSize,
          );

          if (renderIslandStructures && island.structures[rowIndex]?.[columnIndex]) {
            const hasLeft = island.structures[rowIndex]?.[columnIndex - 1] ?? false;
            const hasRight = island.structures[rowIndex]?.[columnIndex + 1] ?? false;
            const hasTop = island.structures[rowIndex - 1]?.[columnIndex] ?? false;
            const hasBottom = island.structures[rowIndex + 1]?.[columnIndex] ?? false;
                    const structureFamily = this.map.tiles.island.structures[0];
            const structureTile = this.getStructureTile(
              structureFamily,
              hasLeft,
              hasRight,
              hasTop,
              hasBottom,
            );
            const structureTexture = this.textures.get(structureTile);
            if (structureTexture) {
              this.addTile(
                this.islandLayer,
                structureTexture,
                originX + columnIndex * this.map.tileSize,
                originY + rowIndex * this.map.tileSize,
              );
            }
          }

        });
      });
      this.islandShadows.endFill();
    }
  }

  private updatePlayerShadow(x: number, y: number, rotation: number): void {
    this.playerShadow.clear();
    this.playerShadow.beginFill(0xffffff, 0.24);
    this.playerShadow.drawEllipse(8, 18, 28, 9);
    this.playerShadow.endFill();
    this.playerShadow.position.set(x, y);
    this.playerShadow.rotation = rotation;
  }

  private getStructureTile(
    structureFamily: GeneratedMap["tiles"]["island"]["structures"][number],
    hasLeft: boolean,
    hasRight: boolean,
    hasTop: boolean,
    hasBottom: boolean,
  ): number {
    const pick = (tile: number): number => tile;
    if (hasLeft && hasRight && !hasTop && !hasBottom) {
      return pick(structureFamily.horizontal);
    }
    if (hasTop && hasBottom && !hasLeft && !hasRight) {
      return pick(structureFamily.vertical);
    }
    if (hasRight && !hasLeft && !hasTop && !hasBottom) {
      return pick(structureFamily.endLeft);
    }
    if (hasLeft && !hasRight && !hasTop && !hasBottom) {
      return pick(structureFamily.endRight);
    }
    if (hasBottom && !hasTop && !hasLeft && !hasRight) {
      return pick(structureFamily.endTop);
    }
    if (hasTop && !hasBottom && !hasLeft && !hasRight) {
      return pick(structureFamily.endBottom);
    }
    return pick(structureFamily.detail);
  }

  private getInteriorTile(row: number, column: number): number {
    const tiles = this.map.tiles.island.random.length > 0
      ? this.map.tiles.island.random
      : this.map.tiles.island.interior;
    return tiles[(row * 31 + column * 17) % tiles.length];
  }

  private getSandTile(row: number, column: number): number {
    const tiles = this.map.tiles.island.sand;
    return tiles[(row * 13 + column * 29) % tiles.length];
  }

  private getIsolatedTile(row: number, column: number): number {
    const isolated = this.map.tiles.island.isolated;
    const variant = (row * 19 + column * 37) % 6;
    switch (variant) {
      case 1: return isolated.top;
      case 2: return isolated.vertical;
      case 3: return isolated.bottom;
      case 4: return isolated.right;
      case 5: return isolated.left;
      default: return isolated.horizontal;
    }
  }

  private getThinSandTile(cells: boolean[][], row: number, column: number): number | undefined {
    const isolated = this.map.tiles.island.isolated;
    const rowRun = this.countRun(cells, row, column, 0, -1) +
      this.countRun(cells, row, column, 0, 1) - 1;
    const columnRun = this.countRun(cells, row, column, -1, 0) +
      this.countRun(cells, row, column, 1, 0) - 1;
    const rowThickness = this.countThickness(cells, row, column, true);
    const columnThickness = this.countThickness(cells, row, column, false);

    if (rowRun >= 3 && rowThickness === 1) {
      if (!cells[row]?.[column - 1]) return isolated.left;
      if (!cells[row]?.[column + 1]) return isolated.right;
      return isolated.horizontal;
    }
    if (columnRun >= 3 && columnThickness === 1) {
      if (!cells[row - 1]?.[column]) return isolated.top;
      if (!cells[row + 1]?.[column]) return isolated.bottom;
      return isolated.vertical;
    }
    return undefined;
  }

  private getThinCorridorCornerTile(
    cells: boolean[][],
    row: number,
    column: number,
  ): number | undefined {
    const thickness = this.getCorridorThickness(cells, row, column);
    if (thickness !== 2) {
      return undefined;
    }

    const top = Boolean(cells[row - 1]?.[column]);
    const right = Boolean(cells[row]?.[column + 1]);
    const bottom = Boolean(cells[row + 1]?.[column]);
    const left = Boolean(cells[row]?.[column - 1]);
    const diagonalTopLeft = Boolean(cells[row - 1]?.[column - 1]);
    const diagonalTopRight = Boolean(cells[row - 1]?.[column + 1]);
    const diagonalBottomLeft = Boolean(cells[row + 1]?.[column - 1]);
    const diagonalBottomRight = Boolean(cells[row + 1]?.[column + 1]);
    const corners = this.map.tiles.island.thinCorridorCorner;

    if (top && left && !diagonalTopLeft) return corners.topLeft;
    if (top && right && !diagonalTopRight) return corners.topRight;
    if (bottom && left && !diagonalBottomLeft) return corners.bottomLeft;
    if (bottom && right && !diagonalBottomRight) return corners.bottomRight;
    return undefined;
  }

  private getCorridorThickness(cells: boolean[][], row: number, column: number): 1 | 2 | undefined {
    const rowRun = this.countRun(cells, row, column, 0, -1) +
      this.countRun(cells, row, column, 0, 1) - 1;
    const columnRun = this.countRun(cells, row, column, -1, 0) +
      this.countRun(cells, row, column, 1, 0) - 1;
    const rowThickness = this.countThickness(cells, row, column, true);
    const columnThickness = this.countThickness(cells, row, column, false);

    if (rowRun >= 3 && rowThickness <= 2) return rowThickness as 1 | 2;
    if (columnRun >= 3 && columnThickness <= 2) return columnThickness as 1 | 2;
    return undefined;
  }

  private countRun(
    cells: boolean[][],
    row: number,
    column: number,
    rowStep: number,
    columnStep: number,
  ): number {
    let count = 0;
    let currentRow = row;
    let currentColumn = column;
    while (cells[currentRow]?.[currentColumn]) {
      count += 1;
      currentRow += rowStep;
      currentColumn += columnStep;
    }
    return count;
  }

  private countThickness(
    cells: boolean[][],
    row: number,
    column: number,
    horizontal: boolean,
  ): number {
    const rowStep = horizontal ? 1 : 0;
    const columnStep = horizontal ? 0 : 1;
    return this.countRun(cells, row, column, -rowStep, -columnStep) +
      this.countRun(cells, row, column, rowStep, columnStep) - 1;
  }

  private getIslandTile(
    cells: boolean[][],
    row: number,
    column: number,
    shorelineTile: number | undefined,
  ): number {
    const hasOccupiedNeighbor = Boolean(
      cells[row - 1]?.[column] ||
      cells[row]?.[column + 1] ||
      cells[row + 1]?.[column] ||
      cells[row]?.[column - 1],
    );
    if (!hasOccupiedNeighbor) {
      return this.getIsolatedTile(row, column);
    }
    if (shorelineTile !== undefined) {
      return shorelineTile;
    }

    return this.getInteriorTile(row, column);
  }

  private getGrassTransitionTileForBorder(
    cells: boolean[][],
    row: number,
    column: number,
  ): number | undefined {
    const transitions = this.map.tiles.island.grassTransition;
    const top = !cells[row - 1]?.[column];
    const right = !cells[row]?.[column + 1];
    const bottom = !cells[row + 1]?.[column];
    const left = !cells[row]?.[column - 1];
    const choose = (tiles: number[]): number | undefined =>
      tiles.length > 0 ? tiles[(row * 17 + column * 31) % tiles.length] : undefined;

    if (top && left && !right && !bottom) return choose(transitions.topLeft);
    if (top && right && !bottom && !left) return choose(transitions.topRight);
    if (bottom && left && !top && !right) return choose(transitions.bottomLeft);
    if (bottom && right && !top && !left) return choose(transitions.bottomRight);
    if (top && !right && !bottom && !left) return choose(transitions.top);
    if (right && !top && !bottom && !left) return choose(transitions.right);
    if (bottom && !top && !right && !left) return choose(transitions.bottom);
    if (left && !top && !right && !bottom) return choose(transitions.left);
    return undefined;
  }

  private getInnerCornerTransitionTile(
    cells: boolean[][],
    row: number,
    column: number,
  ): number | undefined {
    const top = Boolean(cells[row - 1]?.[column]);
    const right = Boolean(cells[row]?.[column + 1]);
    const bottom = Boolean(cells[row + 1]?.[column]);
    const left = Boolean(cells[row]?.[column - 1]);
    const diagonalTopLeft = Boolean(cells[row - 1]?.[column - 1]);
    const diagonalTopRight = Boolean(cells[row - 1]?.[column + 1]);
    const diagonalBottomLeft = Boolean(cells[row + 1]?.[column - 1]);
    const diagonalBottomRight = Boolean(cells[row + 1]?.[column + 1]);
    const transitions = this.map.tiles.island.innerCornerTransition;

    if (top && left && !diagonalTopLeft) return transitions.topLeft[0];
    if (top && right && !diagonalTopRight) return transitions.topRight[0];
    if (bottom && left && !diagonalBottomLeft) return transitions.bottomLeft[0];
    if (bottom && right && !diagonalBottomRight) return transitions.bottomRight[0];
    return undefined;
  }

  private getShorelineTileForCell(
    cells: boolean[][],
    row: number,
    column: number,
  ): number | undefined {
    const top = !cells[row - 1]?.[column];
    const right = !cells[row]?.[column + 1];
    const bottom = !cells[row + 1]?.[column];
    const left = !cells[row]?.[column - 1];
    const shoreline = this.map.tiles.shoreline;
    if (top && left) return shoreline.topLeft;
    if (top && right) return shoreline.topRight;
    if (bottom && left) return shoreline.bottomLeft;
    if (bottom && right) return shoreline.bottomRight;
    if (top) return shoreline.top;
    if (right) return shoreline.right;
    if (bottom) return shoreline.bottom;
    if (left) return shoreline.left;
    return undefined;
  }

  private addTile(layer: Container, texture: Texture, x: number, y: number): void {
    const tile = new Sprite(texture);
    tile.x = x;
    tile.y = y;
    layer.addChild(tile);
  }

  private clearLayer(layer: Container): void {
    layer.removeChildren().forEach((child) => child.destroy());
  }
}
