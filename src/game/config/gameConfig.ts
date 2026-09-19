export interface GameConfig {
  // These values are copied when a match starts, so balance changes do not
  // alter a match that is already running.
  sessionDurationSeconds: number;
  enemySpawnIntervalSeconds: number;
  soundEnabled: boolean;
  soundVolume: number;
  showFps: boolean;
  showEnemyDebug: boolean;
  player: {
    maxHealth: number;
    moveSpeed: number;
    rotationSpeed: number;
  };
  weapons: {
    frontal: {
      cooldownSeconds: number;
      damage: number;
      projectileSpeed: number;
      lifetimeSeconds: number;
    };
    broadside: {
      cooldownSeconds: number;
      damage: number;
      projectileSpeed: number;
      lifetimeSeconds: number;
      projectileCount: number;
      spreadRadians: number;
    };
  };
  enemies: {
    chaserHealth: number;
    chaserSpeed: number;
    chaserDamage: number;
    chaserSmallHealth: number;
    chaserSmallDamage: number;
    shooterHealth: number;
    shooterSpeed: number;
    shooterDamage: number;
    shooterAttackRange: number;
    shooterCooldownSeconds: number;
    shooterMinDistance: number;
    shooterMaxDistance: number;
    shooterSinkDurationSeconds: number;
  };
}

// The single source of truth for the initial gameplay balance.
export const defaultGameConfig: GameConfig = {
  sessionDurationSeconds: 120,
  enemySpawnIntervalSeconds: 5,
  soundEnabled: true,
  soundVolume: 0.8,
  showFps: false,
  showEnemyDebug: false,
  player: {
    maxHealth: 140,
    moveSpeed: 190,
    rotationSpeed: 2.7,
  },
  weapons: {
    frontal: {
      cooldownSeconds: 1.2,
      damage: 25,
      projectileSpeed: 560,
      lifetimeSeconds: 4,
    },
    broadside: {
      cooldownSeconds: 0.9,
      damage: 20,
      projectileSpeed: 420,
      lifetimeSeconds: 1.7,
      projectileCount: 3,
      spreadRadians: 0.18,
    },
  },
  enemies: {
    chaserHealth: 60,
    chaserSpeed: 72,
    chaserDamage: 18,
    chaserSmallHealth: 35,
    chaserSmallDamage: 12,
    shooterHealth: 48,
    shooterSpeed: 52,
    shooterDamage: 12,
    shooterAttackRange: 330,
    shooterCooldownSeconds: 2.3,
    shooterMinDistance: 150,
    shooterMaxDistance: 240,
    shooterSinkDurationSeconds: 3,
  },
};

// These limits are shared by the Options form and future validation logic.
export const GAME_LIMITS = {
  sessionDurationSeconds: { min: 60, max: 180 },
  enemySpawnIntervalSeconds: { min: 1, max: 30 },
} as const;
