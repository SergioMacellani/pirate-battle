import type { GameConfig } from "./gameConfig";

const CONFIG_STORAGE_KEY = "pirate-battle:game-config";

// Restore player options without making a malformed localStorage value crash
// the application. The default configuration remains the fallback.
export function loadGameConfig(defaultConfig: GameConfig): GameConfig {
  const storedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!storedConfig) {
    return defaultConfig;
  }

  try {
    const stored = JSON.parse(storedConfig) as Partial<GameConfig>;
    return {
      ...defaultConfig,
      ...stored,
      player: { ...defaultConfig.player, ...stored.player },
      weapons: {
        frontal: { ...defaultConfig.weapons.frontal, ...stored.weapons?.frontal },
        broadside: { ...defaultConfig.weapons.broadside, ...stored.weapons?.broadside },
      },
      enemies: { ...defaultConfig.enemies, ...stored.enemies },
    };
  } catch {
    return defaultConfig;
  }
}

export function saveGameConfig(config: GameConfig): void {
  // JSON keeps the persisted value simple and allows it to survive a refresh.
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}
