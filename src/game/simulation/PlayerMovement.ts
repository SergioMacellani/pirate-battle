import type { GameConfig } from "../config/gameConfig";
import type { Vector2 } from "../model/gameTypes";

interface PlayerMovementInput {
  forward: boolean;
  backward: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

export interface PlayerMovementContext {
  arena: { width: number; height: number };
  collidesWithIsland: (x: number, y: number) => boolean;
  collidesWithEnemy: (x: number, y: number) => boolean;
}

export function updatePlayerMovement(
  position: Vector2,
  rotation: number,
  input: PlayerMovementInput,
  delta: number,
  config: GameConfig,
  context: PlayerMovementContext,
): { position: Vector2; rotation: number } {
  let nextRotation = rotation;
  if (input.rotateLeft) {
    nextRotation -= config.player.rotationSpeed * delta;
  }
  if (input.rotateRight) {
    nextRotation += config.player.rotationSpeed * delta;
  }

  const direction = Number(input.backward) - Number(input.forward);
  if (direction === 0) {
    return { position: { ...position }, rotation: nextRotation };
  }

  const movementX = Math.sin(nextRotation) * direction * config.player.moveSpeed * delta;
  const movementY = -Math.cos(nextRotation) * direction * config.player.moveSpeed * delta;
  const radius = 22;
  const clampX = (value: number) => Math.max(radius, Math.min(context.arena.width - radius, value));
  const clampY = (value: number) => Math.max(radius, Math.min(context.arena.height - radius, value));
  const nextPosition = { ...position };
  const nextX = clampX(position.x + movementX);
  if (!context.collidesWithIsland(nextX, position.y) && !context.collidesWithEnemy(nextX, position.y)) {
    nextPosition.x = nextX;
  }
  const nextY = clampY(position.y + movementY);
  if (!context.collidesWithIsland(nextPosition.x, nextY) && !context.collidesWithEnemy(nextPosition.x, nextY)) {
    nextPosition.y = nextY;
  }

  return { position: nextPosition, rotation: nextRotation };
}