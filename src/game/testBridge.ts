import type { GameInput, GameSimulation } from "./simulation/GameSimulation";
import type { GameSnapshot } from "./model/gameTypes";

export interface GameTestBridge {
  getSnapshot: () => GameSnapshot | undefined;
  setInput: (input: Partial<GameInput>) => void;
  damagePlayer: (amount: number) => void;
  setPaused: (paused: boolean) => void;
  setControlledClock: (controlled: boolean) => void;
  advance: (seconds: number) => void;
  reset: () => void;
  setSpawningEnabled: (enabled: boolean) => void;
}

export function installGameTestBridge(bridge: GameTestBridge): void {
  window.__PIRATE_BATTLE_TEST__ = bridge;
}

export function removeGameTestBridge(): void {
  delete window.__PIRATE_BATTLE_TEST__;
}

export function updateControlledSimulation(simulation: GameSimulation, seconds: number): void {
  const steps = Math.ceil(Math.max(0, seconds) / 0.05);
  const step = steps > 0 ? seconds / steps : 0;
  for (let index = 0; index < steps; index += 1) {
    simulation.update(step);
  }
}

declare global {
  interface Window {
    __PIRATE_BATTLE_TEST__?: GameTestBridge;
  }
}