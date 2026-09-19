import type { GameConfig } from "../config/gameConfig";

export interface Vector2 {
  x: number;
  y: number;
}

export type GamePhase = "idle" | "running" | "paused" | "finished";

// Abandoned matches will be represented by the application flow, but are not
// valid results for ranking and history submission.
export type EndReason = "time" | "player-defeated" | "abandoned";

// This is the small, serializable view consumed by the renderer and HUD.
export interface ProjectileSnapshot {
  id: string;
  x: number;
  y: number;
  rotation: number;
  damage: number;
  travelled: number;
  owner: "player" | "enemy";
}

export interface ImpactSnapshot {
  id: string;
  x: number;
  y: number;
  progress: number;
}

export interface EnemySnapshot {
  id: string;
  x: number;
  y: number;
  rotation: number;
  health: number;
  maxHealth: number;
  baseShipNumber: number;
  asset: "ship" | "dinghy_large" | "dinghy_small";
  moving: boolean;
  positioned: boolean;
  sinking: boolean;
  sinkProgress: number;
  defeated: boolean;
  blockedBy?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface GameSnapshot {
  phase: GamePhase;
  endReason?: Exclude<EndReason, "abandoned">;
  score: number;
  remainingSeconds: number;
  playerHealth: number;
  playerPosition: Vector2;
  playerRotation: number;
  projectiles: ProjectileSnapshot[];
  impacts: ImpactSnapshot[];
  enemies: EnemySnapshot[];
  shotsFired: number;
  broadsideShotsFired: number;
  config: GameConfig;
}

export interface MatchResult {
  matchId: string;
  score: number;
  playedSeconds: number;
  endReason: Exclude<EndReason, "abandoned">;
  config: GameConfig;
  completedAt: string;
}
