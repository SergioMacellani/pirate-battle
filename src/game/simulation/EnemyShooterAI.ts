import { updateEnemyNavigation, type EnemyAIContext, type EnemyAIUnit, type NavigationGrid } from "./EnemyAI";

export type { NavigationGrid } from "./EnemyAI";

export interface ShooterAIEnemy extends EnemyAIUnit {
  x: number;
  y: number;
  radius: number;
  speed: number;
  orbitDirection: number;
  minDistance: number;
  maxDistance: number;
  pathWaypoint?: { x: number; y: number };
  pathTarget?: { x: number; y: number };
  pathCooldown?: number;
}

export interface ShooterAIContext extends EnemyAIContext {
  player: { x: number; y: number };
  islands: Array<{ x: number; y: number; width: number; height: number }>;
  enemies: ShooterAIEnemy[];
  arena: { width: number; height: number };
  minDistance: number;
  maxDistance: number;
  navigationGrid?: NavigationGrid;
}

export interface ShooterAIDecision {
  x: number;
  y: number;
  rotation: number;
  moving: boolean;
  positioned: boolean;
  blockedBy?: { x: number; y: number; width: number; height: number };
}

const POSITIONING_MARGIN = 12;
const POSITIONING_TOLERANCE = 18;

export { bakeNavigationGrid } from "./EnemyAI";

export function updateShooterAI(
  enemy: ShooterAIEnemy,
  context: ShooterAIContext,
  delta: number,
): ShooterAIDecision {
  enemy.pathCooldown = Math.max(0, (enemy.pathCooldown ?? 0) - delta);
  const toPlayerX = context.player.x - enemy.x;
  const toPlayerY = context.player.y - enemy.y;
  const playerDistance = Math.hypot(toPlayerX, toPlayerY) || 1;
  const playerDirection = { x: toPlayerX / playerDistance, y: toPlayerY / playerDistance };
  const targetDistance = context.minDistance + POSITIONING_MARGIN;

  const target = playerDistance < targetDistance - POSITIONING_TOLERANCE || playerDistance > targetDistance + POSITIONING_TOLERANCE
    ? {
      x: context.player.x - playerDirection.x * targetDistance,
      y: context.player.y - playerDirection.y * targetDistance,
    }
    : { x: enemy.x, y: enemy.y };
  const navigation = updateEnemyNavigation(enemy, target, context, delta);
  const desired = { x: navigation.x, y: navigation.y };
  const nextX = desired.x;
  const nextY = desired.y;
  const moving = Math.hypot(nextX - enemy.x, nextY - enemy.y) > 0.01;
  const nextPlayerDistance = Math.hypot(context.player.x - nextX, context.player.y - nextY);
  const positioned = nextPlayerDistance >= context.minDistance && nextPlayerDistance <= context.maxDistance;
  const movementAngle = Math.atan2(nextY - enemy.y, nextX - enemy.x);
  const playerAngle = Math.atan2(toPlayerY, toPlayerX);
  const rotation = moving ? movementAngle - Math.PI / 2 : playerAngle - Math.PI / 2;

  return { x: nextX, y: nextY, rotation, moving, positioned };
}
