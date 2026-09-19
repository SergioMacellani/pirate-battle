import type { GameConfig } from "../config/gameConfig";
import type {
  GamePhase,
  GameSnapshot,
  MatchResult,
} from "../model/gameTypes";
import { bakeNavigationGrid, updateShooterAI, type NavigationGrid } from "./EnemyShooterAI";
import { updateEnemyNavigation } from "./EnemyAI";
import { updatePlayerMovement } from "./PlayerMovement";

interface CollisionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Projectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  damage: number;
  travelled: number;
  maxTravel: number;
  owner: "player" | "enemy";
}

interface Impact {
  id: string;
  x: number;
  y: number;
  progress: number;
}

interface Enemy {
  type: "shooter" | "chaser";
  id: string;
  x: number;
  y: number;
  rotation: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  baseShipNumber: number;
  asset: "ship" | "dinghy_large" | "dinghy_small";
  moving: boolean;
  positioned: boolean;
  attackCooldown: number;
  sinking: boolean;
  sinkProgress: number;
  orbitDirection: number;
  minDistance: number;
  maxDistance: number;
  blockedBy?: CollisionRect;
  pathWaypoint?: { x: number; y: number };
  pathTarget?: { x: number; y: number };
  pathCooldown?: number;
}

const ENEMY_DEFEAT_SCORE = 1;

function rotateTowards(current: number, target: number, maxStep: number): number {
  const fullTurn = Math.PI * 2;
  const difference = ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  if (Math.abs(difference) <= maxStep) {
    return target;
  }
  return current + Math.sign(difference) * maxStep;
}

export interface GameInput {
  forward: boolean;
  backward: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  shoot: boolean;
  broadsideLeft: boolean;
  broadsideRight: boolean;
}

const EMPTY_INPUT: GameInput = {
  forward: false,
  backward: false,
  rotateLeft: false,
  rotateRight: false,
  shoot: false,
  broadsideLeft: false,
  broadsideRight: false,
};

export class GameSimulation {
  private readonly config: GameConfig;
  private phase: GamePhase = "idle";
  private remainingSeconds: number;
  private playedSeconds = 0;
  private playerHealth: number;
  private playerPosition = { x: 0, y: 0 };
  private playerRotation = 0;
  private arenaSize = { width: 800, height: 600 };
  private collisionRects: CollisionRect[] = [];
  private structureCollisionRects: CollisionRect[] = [];
  private navigationGrid?: NavigationGrid;
  private readonly playerRadius = 22;
  private readonly enemySpawnSafeDistance = 400;
  private readonly chaserExplosionRadius = 110;
  private score = 0;
  private input: GameInput = EMPTY_INPUT;
  private fireCooldown = 0;
  private spawnCooldown = 0;
  private projectiles: Projectile[] = [];
  private impacts: Impact[] = [];
  private enemies: Enemy[] = [];
  private result?: MatchResult;
  private enemySpawnIndex = 0;
  private shotsFired = 0;
  private broadsideShotsFired = 0;
  private spawningEnabled = true;

  public constructor(config: GameConfig) {
    this.config = structuredClone(config);
    this.remainingSeconds = config.sessionDurationSeconds;
    this.playerHealth = config.player.maxHealth;
    this.spawnCooldown = config.enemySpawnIntervalSeconds;
  }

  public start(): void {
    if (this.phase !== "idle") {
      return;
    }

    this.phase = "running";
  }

  public setArenaSize(width: number, height: number): void {
    this.arenaSize = { width, height };
    this.playerPosition = { x: width / 2, y: height / 2 };
    this.navigationGrid = bakeNavigationGrid(this.collisionRects, this.arenaSize, 23);
  }

  public resizeArena(width: number, height: number): void {
    this.arenaSize = { width, height };
    this.playerPosition = {
      x: Math.max(this.playerRadius, Math.min(width - this.playerRadius, this.playerPosition.x)),
      y: Math.max(this.playerRadius, Math.min(height - this.playerRadius, this.playerPosition.y)),
    };
    this.navigationGrid = bakeNavigationGrid(this.collisionRects, this.arenaSize, 23);
  }

  public setCollisionRects(rects: CollisionRect[]): void {
    this.collisionRects = rects.map((rect) => ({ ...rect }));
    this.navigationGrid = bakeNavigationGrid(this.collisionRects, this.arenaSize, 23);
  }

  public setStructureCollisionRects(rects: CollisionRect[]): void {
    this.structureCollisionRects = rects.map((rect) => ({ ...rect }));
  }

  public update(deltaSeconds: number): void {
    if (this.phase !== "running") {
      return;
    }

    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.playedSeconds += delta;
    this.remainingSeconds = Math.max(0, this.remainingSeconds - delta);
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    this.spawnCooldown = Math.max(0, this.spawnCooldown - delta);

    const playerMovement = updatePlayerMovement(
      this.playerPosition,
      this.playerRotation,
      this.input,
      delta,
      this.config,
      {
        arena: this.arenaSize,
        collidesWithIsland: (x, y) => this.collidesWithIsland(x, y),
        collidesWithEnemy: (x, y) => this.collidesWithEnemy(x, y),
      },
    );
    this.playerPosition = playerMovement.position;
    this.playerRotation = playerMovement.rotation;

    if (this.input.shoot && this.fireCooldown <= 0) {
      const broadside = this.input.broadsideLeft
        ? -1
        : this.input.broadsideRight
          ? 1
          : 0;
      if (broadside === 0) {
        this.shotsFired += 1;
        const weapon = this.config.weapons.frontal;
        this.fireCooldown = weapon.cooldownSeconds;
        const forward = this.getPlayerForwardVector();
        this.spawnProjectile(
          "player",
          this.playerPosition,
          { x: this.playerPosition.x + forward.x, y: this.playerPosition.y + forward.y },
          weapon.damage,
          weapon.projectileSpeed,
          weapon.lifetimeSeconds,
        );
      } else {
        this.broadsideShotsFired += 1;
        this.fireCooldown = this.config.weapons.broadside.cooldownSeconds;
        this.spawnPlayerBroadside(broadside);
      }
    }

    this.updateProjectiles(delta);
    this.impacts = this.impacts
      .map((impact) => ({ ...impact, progress: impact.progress + delta / 0.45 }))
      .filter((impact) => impact.progress < 1);
    this.updateEnemies(delta);

    if (this.remainingSeconds === 0) {
      this.finish("time");
    }

    if (this.spawningEnabled && this.spawnCooldown <= 0) {
      this.spawnEnemy();
      this.spawnCooldown = Math.max(1, this.config.enemySpawnIntervalSeconds);
    }
  }

  public setInput(input: Partial<GameInput>): void {
    this.input = {
      ...this.input,
      ...input,
      forward: input.forward ?? this.input.forward,
      backward: input.backward ?? this.input.backward,
      rotateLeft: input.rotateLeft ?? this.input.rotateLeft,
      rotateRight: input.rotateRight ?? this.input.rotateRight,
      shoot: input.shoot ?? this.input.shoot,
      broadsideLeft: input.broadsideLeft ?? this.input.broadsideLeft,
      broadsideRight: input.broadsideRight ?? this.input.broadsideRight,
    };
  }

  public pause(): void {
    if (this.phase === "running") {
      this.phase = "paused";
    }
  }

  public resume(): void {
    if (this.phase === "paused") {
      this.phase = "running";
    }
  }

  public damagePlayer(amount: number): void {
    if (this.phase !== "running") {
      return;
    }

    this.playerHealth = Math.max(0, this.playerHealth - Math.max(0, amount));
    if (this.playerHealth === 0) {
      this.finish("player-defeated");
    }
  }

  public addScore(amount = 1): void {
    if (this.phase === "running") {
      this.score += Math.max(0, amount);
    }
  }

  public setSpawningEnabled(enabled: boolean): void {
    this.spawningEnabled = enabled;
  }

  public getSnapshot(): GameSnapshot {
    return {
      phase: this.phase,
      endReason: this.result?.endReason,
      score: this.score,
      remainingSeconds: this.remainingSeconds,
      playerHealth: this.playerHealth,
      playerPosition: { ...this.playerPosition },
      playerRotation: this.playerRotation,
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        x: projectile.x,
        y: projectile.y,
        rotation: projectile.rotation,
        damage: projectile.damage,
        travelled: projectile.travelled,
        owner: projectile.owner,
      })),
      impacts: this.impacts.map((impact) => ({ ...impact })),
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        rotation: enemy.rotation,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        baseShipNumber: enemy.baseShipNumber,
        asset: enemy.asset,
        moving: enemy.moving,
        positioned: enemy.positioned,
        sinking: enemy.sinking,
        sinkProgress: enemy.sinkProgress,
        defeated: enemy.health <= 0,
        blockedBy: enemy.blockedBy,
      })),
      shotsFired: this.shotsFired,
      broadsideShotsFired: this.broadsideShotsFired,
      config: this.config,
    };
  }

  public getResult(): MatchResult | undefined {
    return this.result;
  }

  public reset(): void {
    this.phase = "idle";
    this.remainingSeconds = this.config.sessionDurationSeconds;
    this.playedSeconds = 0;
    this.playerHealth = this.config.player.maxHealth;
    this.score = 0;
    this.playerRotation = 0;
    this.input = EMPTY_INPUT;
    this.fireCooldown = 0;
    this.spawnCooldown = this.config.enemySpawnIntervalSeconds;
    this.projectiles = [];
    this.impacts = [];
    this.enemies = [];
    this.result = undefined;
    this.enemySpawnIndex = 0;
    this.shotsFired = 0;
    this.broadsideShotsFired = 0;
  }

  private spawnProjectile(
    owner: "player" | "enemy",
    origin: { x: number; y: number },
    target: { x: number; y: number },
    damage: number,
    speed = this.config.weapons.frontal.projectileSpeed,
    lifetime = this.config.weapons.frontal.lifetimeSeconds,
  ): void {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const length = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const projectile: Projectile = {
      id: `proj-${crypto.randomUUID()}`,
      x: origin.x,
      y: origin.y,
      vx: (dx / length) * speed,
      vy: (dy / length) * speed,
      rotation: angle,
      damage,
      travelled: 0,
      maxTravel: speed * lifetime,
      owner,
    };

    this.projectiles.push(projectile);
  }

  private getPlayerForwardVector(): { x: number; y: number } {
    return { x: -Math.sin(this.playerRotation), y: Math.cos(this.playerRotation) };
  }

  private spawnPlayerBroadside(side: -1 | 1): void {
    const weapon = this.config.weapons.broadside;
    const forward = this.getPlayerForwardVector();
    const left = { x: forward.y, y: -forward.x };
    const right = { x: -forward.y, y: forward.x };
    const sideVector = side === -1 ? left : right;
    const center = (weapon.projectileCount - 1) / 2;
    const sideOrigin = {
      x: this.playerPosition.x + sideVector.x * 18,
      y: this.playerPosition.y + sideVector.y * 18,
    };

    for (let index = 0; index < weapon.projectileCount; index += 1) {
      const forwardOffset = (index - center) * 14;
      const origin = {
        x: sideOrigin.x + forward.x * forwardOffset,
        y: sideOrigin.y + forward.y * forwardOffset,
      };
      this.spawnProjectile(
        "player",
        origin,
        { x: origin.x + sideVector.x, y: origin.y + sideVector.y },
        weapon.damage,
        weapon.projectileSpeed,
        weapon.lifetimeSeconds,
      );
    }
  }

  private updateProjectiles(delta: number): void {
    const survivors: Projectile[] = [];

    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.travelled += Math.hypot(projectile.vx * delta, projectile.vy * delta);
      projectile.rotation = Math.atan2(projectile.vy, projectile.vx);

      if (projectile.travelled >= projectile.maxTravel) {
        continue;
      }

      let hitTarget = false;
      if (this.collidesWithStructure(projectile.x, projectile.y)) {
        this.addImpact(projectile.x, projectile.y);
        hitTarget = true;
      } else if (projectile.owner === "player") {
        for (const enemy of this.enemies) {
          if (enemy.sinking) {
            continue;
          }
          const distance = Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y);
          if (distance <= enemy.radius + 12) {
            this.addImpact(projectile.x, projectile.y);
            enemy.health = Math.max(0, enemy.health - projectile.damage);
            if (enemy.health === 0) {
              enemy.sinking = true;
            }
            hitTarget = true;
            if (enemy.health <= 0) {
              this.addScore(ENEMY_DEFEAT_SCORE);
            }
            break;
          }
        }
      } else if (
        Math.hypot(
          projectile.x - this.playerPosition.x,
          projectile.y - this.playerPosition.y,
        ) <= this.playerRadius + 12
      ) {
        this.addImpact(projectile.x, projectile.y);
        this.damagePlayer(projectile.damage);
        hitTarget = true;
      }

      if (!hitTarget) {
        survivors.push(projectile);
      }
    }

    this.projectiles = survivors.filter((projectile) => {
      const inBounds =
        projectile.x >= -16 &&
        projectile.x <= this.arenaSize.width + 16 &&
        projectile.y >= -16 &&
        projectile.y <= this.arenaSize.height + 16;
      return inBounds;
    });

    this.enemies = this.enemies.filter((enemy) => {
      if (!enemy.sinking) {
        return true;
      }
      enemy.sinkProgress = Math.min(
        1,
        enemy.sinkProgress + delta / this.config.enemies.shooterSinkDurationSeconds,
      );
      return enemy.sinkProgress < 1;
    });
  }

  private addImpact(x: number, y: number): void {
    this.impacts.push({ id: `impact-${crypto.randomUUID()}`, x, y, progress: 0 });
  }

  private updateEnemies(delta: number): void {
    const activeEnemies = this.enemies.filter((enemy) => !enemy.sinking);
    for (const enemy of this.enemies) {
      if (enemy.sinking) {
        continue;
      }

      const decision = enemy.type === "chaser"
        ? updateEnemyNavigation(enemy, this.playerPosition, {
          islands: this.collisionRects,
          enemies: activeEnemies,
          arena: this.arenaSize,
          navigationGrid: this.navigationGrid,
        }, delta)
        : updateShooterAI(enemy, {
          player: this.playerPosition,
          islands: this.collisionRects,
          enemies: activeEnemies,
          arena: this.arenaSize,
          minDistance: enemy.minDistance,
          maxDistance: enemy.maxDistance,
          navigationGrid: this.navigationGrid,
        }, delta);
      enemy.x = decision.x;
      enemy.y = decision.y;
      enemy.rotation = rotateTowards(
        enemy.rotation,
        decision.rotation,
        this.config.player.rotationSpeed * 1.8 * delta,
      );
      enemy.moving = decision.moving;
      enemy.positioned = decision.positioned ?? false;
      enemy.blockedBy = decision.blockedBy;
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);

      const playerDistance = Math.hypot(enemy.x - this.playerPosition.x, enemy.y - this.playerPosition.y);
      if (playerDistance <= enemy.radius + this.playerRadius) {
        if (enemy.type === "chaser") {
          this.explodeChaser(enemy);
        } else {
          this.resolveEnemyPlayerCollision(enemy);
        }
      } else if (
        playerDistance >= enemy.minDistance &&
        playerDistance <= enemy.maxDistance &&
        enemy.attackCooldown <= 0
      ) {
        this.spawnEnemyBroadside(enemy);
        enemy.attackCooldown = this.config.enemies.shooterCooldownSeconds;
      }
    }
  }

  private resolveEnemyPlayerCollision(enemy: Enemy): void {
    const dx = this.playerPosition.x - enemy.x;
    const dy = this.playerPosition.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    const minimumDistance = this.playerRadius + enemy.radius;
    const push = Math.max(0, minimumDistance - distance);
    this.playerPosition.x = this.clampX(this.playerPosition.x + (dx / distance) * push);
    this.playerPosition.y = this.clampY(this.playerPosition.y + (dy / distance) * push);
    this.damagePlayer(enemy.damage * 0.25);
  }

  private explodeChaser(chaser: Enemy): void {
    this.addImpact(chaser.x, chaser.y);
    this.damagePlayer(chaser.damage);
    chaser.sinking = true;
    for (const enemy of this.enemies) {
      if (enemy === chaser || enemy.sinking) {
        continue;
      }
      if (Math.hypot(enemy.x - chaser.x, enemy.y - chaser.y) <= this.chaserExplosionRadius) {
        enemy.health = Math.max(0, enemy.health - chaser.damage);
        if (enemy.health === 0) {
          enemy.sinking = true;
        }
      }
    }
  }

  private collidesWithEnemy(centerX: number, centerY: number): boolean {
    return this.enemies.some((enemy) => {
      if (enemy.sinking) {
        return false;
      }
      return Math.hypot(centerX - enemy.x, centerY - enemy.y) < this.playerRadius + enemy.radius;
    });
  }

  private spawnEnemy(): void {
    const spawnPosition = this.findEnemySpawnPosition();
    if (!spawnPosition) {
      return;
    }

    const type = Math.random() < 0.35 ? "chaser" : "shooter";
    const baseShipNumber = type === "shooter" ? [2, 3, 4, 5][Math.floor(Math.random() * 4)] : 0;
    const asset = type === "chaser"
      ? (Math.random() < 0.5 ? "dinghy_large" : "dinghy_small")
      : "ship";
    const maxHealth = type !== "chaser"
      ? this.config.enemies.shooterHealth
      : asset === "dinghy_small"
        ? this.config.enemies.chaserSmallHealth ?? this.config.enemies.chaserHealth * 0.6
        : this.config.enemies.chaserHealth;
    const enemy: Enemy = {
      id: `enemy-${crypto.randomUUID()}`,
      type,
      x: spawnPosition.x,
      y: spawnPosition.y,
      rotation: 0,
      radius: 23,
      health: maxHealth,
      maxHealth,
      speed: type === "chaser" ? this.config.enemies.chaserSpeed : this.config.enemies.shooterSpeed,
      damage: type !== "chaser"
        ? this.config.enemies.shooterDamage
        : asset === "dinghy_small"
          ? this.config.enemies.chaserSmallDamage ?? this.config.enemies.chaserDamage * 0.6
          : this.config.enemies.chaserDamage,
      baseShipNumber,
      asset,
      moving: true,
      positioned: false,
      attackCooldown: 2,
      sinking: false,
      sinkProgress: 0,
      orbitDirection: Math.random() < 0.5 ? -1 : 1,
      minDistance: type === "chaser" ? 0 : this.config.enemies.shooterMinDistance + Math.random() * 30,
      maxDistance: type === "chaser" ? 0 : this.config.enemies.shooterMaxDistance + Math.random() * 70,
      blockedBy: undefined,
      pathWaypoint: undefined,
      pathTarget: undefined,
      pathCooldown: 0,
    };

    this.enemies.push(enemy);
  }

  private spawnEnemyBroadside(enemy: Enemy): void {
    const rightAngle = enemy.rotation + Math.PI / 2;
    const rightX = Math.cos(rightAngle);
    const rightY = Math.sin(rightAngle);
    const toPlayerX = this.playerPosition.x - enemy.x;
    const toPlayerY = this.playerPosition.y - enemy.y;
    const side = Math.sign(toPlayerX * rightX + toPlayerY * rightY) || 1;
    const weapon = this.config.weapons.broadside;
    const origin = {
      x: enemy.x + rightX * side * 18,
      y: enemy.y + rightY * side * 18,
    };
    const targetAngle = Math.atan2(toPlayerY, toPlayerX);
    const center = (weapon.projectileCount - 1) / 2;

    for (let index = 0; index < weapon.projectileCount; index += 1) {
      const angle = targetAngle + (index - center) * weapon.spreadRadians;
      this.spawnProjectile(
        "enemy",
        origin,
        { x: origin.x + Math.cos(angle), y: origin.y + Math.sin(angle) },
        enemy.damage,
        weapon.projectileSpeed,
        weapon.lifetimeSeconds,
      );
    }
  }

  private findEnemySpawnPosition(): { x: number; y: number } | undefined {
    const edgePadding = 32;
    const preferredSide = this.enemySpawnIndex % 4;
    this.enemySpawnIndex += 1;
    const candidates: Array<{ x: number; y: number }> = [];
    const depths = [edgePadding, 72, 112, 152, 192];
    for (const depth of depths) {
      for (let sideOffset = 0; sideOffset < 4; sideOffset += 1) {
        const side = (preferredSide + sideOffset) % 4;
        const progress = 0.08 + Math.random() * 0.84;
        switch (side) {
          case 0:
            candidates.push({ x: this.arenaSize.width * progress, y: depth });
            break;
          case 1:
            candidates.push({ x: this.arenaSize.width - depth, y: this.arenaSize.height * progress });
            break;
          case 2:
            candidates.push({ x: this.arenaSize.width * progress, y: this.arenaSize.height - depth });
            break;
          default:
            candidates.push({ x: depth, y: this.arenaSize.height * progress });
        }
      }
    }

    const isValid = (candidate: { x: number; y: number }): boolean => {
      const safeFromPlayer = Math.hypot(
        candidate.x - this.playerPosition.x,
        candidate.y - this.playerPosition.y,
      ) > this.enemySpawnSafeDistance;
      const safeFromIslands = !this.collidesWithIslandAt(candidate.x, candidate.y, 23);
      const safeFromEnemies = this.enemies.every(
        (enemy) =>
          Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y) >
          enemy.radius + 23 + 12,
      );
      return safeFromPlayer && safeFromIslands && safeFromEnemies;
    };

    const validCandidates = candidates.filter(isValid);
    if (validCandidates.length > 0) {
      return validCandidates.sort((first, second) => {
        const firstDistance = this.distanceToClosestEnemy(first);
        const secondDistance = this.distanceToClosestEnemy(second);
        return secondDistance - firstDistance;
      })[0];
    }

    for (let attempt = 0; attempt < 2048; attempt += 1) {
      const fallback = {
        x: edgePadding + Math.random() * (this.arenaSize.width - edgePadding * 2),
        y: edgePadding + Math.random() * (this.arenaSize.height - edgePadding * 2),
      };
      if (isValid(fallback)) {
        return fallback;
      }
    }

    return undefined;
  }

  private distanceToClosestEnemy(candidate: { x: number; y: number }): number {
    if (this.enemies.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.min(
      ...this.enemies.map((enemy) => Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y)),
    );
  }

  private finish(endReason: "time" | "player-defeated"): void {
    this.phase = "finished";
    this.result = {
      matchId: crypto.randomUUID(),
      score: this.score,
      playedSeconds: this.playedSeconds,
      endReason,
      config: this.config,
      completedAt: new Date().toISOString(),
    };
  }

  private clampX(value: number): number {
    return Math.max(this.playerRadius, Math.min(this.arenaSize.width - this.playerRadius, value));
  }

  private clampY(value: number): number {
    return Math.max(this.playerRadius, Math.min(this.arenaSize.height - this.playerRadius, value));
  }

  private collidesWithIsland(centerX: number, centerY: number): boolean {
    return this.collidesWithIslandAt(centerX, centerY, this.playerRadius);
  }

  private collidesWithStructure(centerX: number, centerY: number): boolean {
    return this.structureCollisionRects.some((rect) =>
      centerX >= rect.x &&
      centerX <= rect.x + rect.width &&
      centerY >= rect.y &&
      centerY <= rect.y + rect.height,
    );
  }

  private collidesWithIslandAt(centerX: number, centerY: number, radius: number): boolean {
    return this.collisionRects.some((rect) => {
      const closestX = Math.max(rect.x, Math.min(centerX, rect.x + rect.width));
      const closestY = Math.max(rect.y, Math.min(centerY, rect.y + rect.height));
      const distanceX = centerX - closestX;
      const distanceY = centerY - closestY;
      return distanceX * distanceX + distanceY * distanceY < radius ** 2;
    });
  }
}
