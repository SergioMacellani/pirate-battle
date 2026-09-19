export interface EnemyAIUnit {
  x: number;
  y: number;
  radius: number;
  speed: number;
  pathWaypoint?: { x: number; y: number };
  pathTarget?: { x: number; y: number };
  pathCooldown?: number;
}

export interface EnemyAIContext {
  islands: Array<{ x: number; y: number; width: number; height: number }>;
  enemies: EnemyAIUnit[];
  arena: { width: number; height: number };
  navigationGrid?: NavigationGrid;
}

export interface NavigationGrid {
  cellSize: number;
  columns: number;
  rows: number;
  blocked: Uint8Array;
}

export interface EnemyAIDecision {
  x: number;
  y: number;
  rotation: number;
  moving: boolean;
  positioned?: boolean;
  blockedBy?: { x: number; y: number; width: number; height: number };
}

const OBSTACLE_PADDING = 28;
const SEPARATION_DISTANCE = 78;
const PATH_CELL_SIZE = 32;
const PATH_DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
] as const;

export function bakeNavigationGrid(
  islands: EnemyAIContext["islands"],
  arena: EnemyAIContext["arena"],
  radius: number,
): NavigationGrid {
  const columns = Math.ceil(arena.width / PATH_CELL_SIZE);
  const rows = Math.ceil(arena.height / PATH_CELL_SIZE);
  const blocked = new Uint8Array(columns * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (islands.some((island) => pointInsidePaddedRect(cellCenter(x, y), island, radius + OBSTACLE_PADDING))) {
        blocked[y * columns + x] = 1;
      }
    }
  }
  return { cellSize: PATH_CELL_SIZE, columns, rows, blocked };
}

export function updateEnemyNavigation(
  enemy: EnemyAIUnit,
  target: { x: number; y: number },
  context: EnemyAIContext,
  delta: number,
): EnemyAIDecision {
  enemy.pathCooldown = Math.max(0, (enemy.pathCooldown ?? 0) - delta);
  let desired = target;
  const directPathBlocked = context.islands.some((island) =>
    segmentIntersectsRect(enemy, target, island, enemy.radius + OBSTACLE_PADDING),
  );

  if (!directPathBlocked) {
    enemy.pathWaypoint = undefined;
    enemy.pathTarget = undefined;
  } else if (
    !enemy.pathWaypoint ||
    !enemy.pathTarget ||
    enemy.pathCooldown === 0 ||
    Math.hypot(enemy.pathTarget.x - target.x, enemy.pathTarget.y - target.y) > PATH_CELL_SIZE
  ) {
    enemy.pathWaypoint = findNextPathWaypoint(enemy, target, context);
    enemy.pathTarget = target;
    enemy.pathCooldown = 0.25;
  }
  desired = enemy.pathWaypoint ?? desired;

  for (const other of context.enemies) {
    const dx = enemy.x - other.x;
    const dy = enemy.y - other.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0 && distance < SEPARATION_DISTANCE) {
      const strength = (SEPARATION_DISTANCE - distance) / SEPARATION_DISTANCE;
      desired = {
        x: desired.x + (dx / distance) * enemy.speed * strength * delta,
        y: desired.y + (dy / distance) * enemy.speed * strength * delta,
      };
    }
  }

  const distanceToDesired = Math.hypot(desired.x - enemy.x, desired.y - enemy.y);
  if (distanceToDesired > enemy.speed * delta) {
    desired = {
      x: enemy.x + ((desired.x - enemy.x) / distanceToDesired) * enemy.speed * delta,
      y: enemy.y + ((desired.y - enemy.y) / distanceToDesired) * enemy.speed * delta,
    };
  }

  const nextX = clamp(desired.x, enemy.radius, context.arena.width - enemy.radius);
  const nextY = clamp(desired.y, enemy.radius, context.arena.height - enemy.radius);
  const moving = Math.hypot(nextX - enemy.x, nextY - enemy.y) > 0.01;
  return {
    x: nextX,
    y: nextY,
    rotation: moving ? Math.atan2(nextY - enemy.y, nextX - enemy.x) - Math.PI / 2 : 0,
    moving,
  };
}

function findNextPathWaypoint(
  enemy: EnemyAIUnit,
  target: { x: number; y: number },
  context: EnemyAIContext,
): { x: number; y: number } | undefined {
  const columns = Math.ceil(context.arena.width / PATH_CELL_SIZE);
  const rows = Math.ceil(context.arena.height / PATH_CELL_SIZE);
  const toCell = (point: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(columns - 1, Math.floor(point.x / PATH_CELL_SIZE))),
    y: Math.max(0, Math.min(rows - 1, Math.floor(point.y / PATH_CELL_SIZE))),
  });
  const start = toCell(enemy);
  const goal = toCell(target);
  const key = (x: number, y: number) => `${x}:${y}`;
  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  const open: Array<{ key: string; priority: number }> = [{ key: startKey, priority: 0 }];
  const cameFrom = new Map<string, string>();
  const costs = new Map<string, number>([[startKey, 0]]);
  const blocked = (x: number, y: number) => context.navigationGrid
    ? context.navigationGrid.blocked[y * context.navigationGrid.columns + x] === 1
    : context.islands.some((island) => pointInsidePaddedRect(cellCenter(x, y), island, enemy.radius + OBSTACLE_PADDING));

  while (open.length > 0) {
    const current = popMin(open)!.key;
    if (current === goalKey) {
      const path = [current];
      while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0])!);
      const [nextX, nextY] = path[Math.min(1, path.length - 1)].split(":").map(Number);
      return cellCenter(nextX, nextY);
    }

    const [currentX, currentY] = current.split(":").map(Number);
    const currentCenter = cellCenter(currentX, currentY);
    for (const [offsetX, offsetY] of PATH_DIRECTIONS) {
      const nextX = currentX + offsetX;
      const nextY = currentY + offsetY;
      if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows || blocked(nextX, nextY)) continue;
      const nextCenter = cellCenter(nextX, nextY);
      if (current !== startKey && context.islands.some((island) =>
        segmentIntersectsRect(currentCenter, nextCenter, island, enemy.radius + OBSTACLE_PADDING),
      )) continue;
      const nextKey = key(nextX, nextY);
      const nextCost = (costs.get(current) ?? Infinity) + Math.hypot(offsetX, offsetY);
      if (nextCost < (costs.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, current);
        costs.set(nextKey, nextCost);
        pushMin(open, { key: nextKey, priority: nextCost + Math.hypot(goal.x - nextX, goal.y - nextY) });
      }
    }
  }
  return undefined;
}

function pushMin(heap: Array<{ key: string; priority: number }>, item: { key: string; priority: number }): void {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].priority <= heap[index].priority) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popMin(heap: Array<{ key: string; priority: number }>): { key: string; priority: number } | undefined {
  if (heap.length === 0) return undefined;
  const minimum = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].priority < heap[smallest].priority) smallest = left;
      if (right < heap.length && heap[right].priority < heap[smallest].priority) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
  return minimum;
}

function segmentIntersectsRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 8));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    if (pointInsidePaddedRect({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    }, rect, padding)) return true;
  }
  return false;
}

function pointInsidePaddedRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  padding: number,
): boolean {
  return point.x >= rect.x - padding && point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding && point.y <= rect.y + rect.height + padding;
}

function cellCenter(x: number, y: number): { x: number; y: number } {
  return { x: (x + 0.5) * PATH_CELL_SIZE, y: (y + 0.5) * PATH_CELL_SIZE };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}