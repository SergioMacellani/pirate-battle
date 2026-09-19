import { useEffect, useRef } from "react";
import { GameRenderer } from "../../game/rendering/GameRender";
import type { GameConfig } from "../../game/config/gameConfig";
import type { GameSnapshot } from "../../game/model/gameTypes";
import type { MatchResult } from "../../game/model/gameTypes";
import type { MobileInputState } from "../../game/input/mobileControls";
import type { SoundManager } from "../../game/audio/SoundManager";

interface GameCanvasProps {
  config: GameConfig;
  seed: number;
  paused: boolean;
  touchInput?: Partial<MobileInputState>;
  onTelemetry?: (snapshot: GameSnapshot, fps: number, samples: number[], result?: MatchResult) => void;
  soundManager?: SoundManager;
}

export function GameCanvas({ config, seed, paused, touchInput, onTelemetry, soundManager }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  // Synced by its own effect (below) so the create effect can read the latest
  // pause state without listing `paused` as a dependency.
  const pausedRef = useRef(paused);
  const telemetryRef = useRef(onTelemetry);
  const soundManagerRef = useRef(soundManager);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    telemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    soundManagerRef.current = soundManager;
  }, [soundManager]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    // React owns the lifecycle; Pixi owns the canvas only while this screen is
    // mounted. This also makes Strict Mode mount/unmount checks safe.
    const renderer = new GameRenderer(config, seed, pausedRef.current, soundManagerRef.current);
    renderer.setTelemetryListener((snapshot, fps, samples, result) => telemetryRef.current?.(snapshot, fps, samples, result));
    rendererRef.current = renderer;

    void renderer.initialize(containerRef.current);

    return () => {
      renderer.destroy();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
    };
  }, [config, seed]);

  useEffect(() => {
    rendererRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    rendererRef.current?.setTouchInput(touchInput ?? {});
  }, [touchInput]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minWidth: "1px",
        minHeight: "1px",
      }}
    />
  );
}