import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GameCanvas } from "./components/game/GameCanvas";
import { GAME_LIMITS, defaultGameConfig } from "./game/config/gameConfig";
import { loadGameConfig, saveGameConfig } from "./game/config/configStorage";
import type { GameConfig } from "./game/config/gameConfig";
import type { GameSnapshot } from "./game/model/gameTypes";
import type { MatchResult } from "./game/model/gameTypes";
import { getPendingMatches, getPlayerId, PLAYER_NAME, sortRanking } from "./game/data/matchApi";
import { useMatchHistory, useRanking, useSubmitMatch } from "./game/data/matchQueries";
import type { MatchRecord } from "./game/model/matchTypes";
import { getNetworkScenario, networkScenarios, resetNetworkState, scenarioLabels, setNetworkScenario, type NetworkScenario } from "./mocks/networkMock";
import { SoundManager } from "./game/audio/SoundManager";

type Screen =
  | "menu"
  | "options"
  | "tutorial"
  | "ranking"
  | "history"
  | "game"
  | "pause"
  | "death"
  | "result";

function createMatchSeed(): number {
  const seedParam = new URLSearchParams(window.location.search).get("seed");
  if (seedParam !== null && seedParam.trim() !== "") {
    const testSeed = Number(seedParam);
    if (Number.isFinite(testSeed)) return testSeed;
  }
  return Math.floor(Math.random() * 1_000_000_000);
}

function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [optionsReturnScreen, setOptionsReturnScreen] = useState<"menu" | "pause">("menu");
  const [config, setConfig] = useState<GameConfig>(() =>
    loadGameConfig(defaultGameConfig),
  );
  // A fresh seed regenerates the map layout for every new match.
  const [matchSeed, setMatchSeed] = useState(createMatchSeed);
  const [matchInstance, setMatchInstance] = useState(0);
  const [gameSnapshot, setGameSnapshot] = useState<GameSnapshot>();
  const [fps, setFps] = useState(0);
  const [fpsSamples, setFpsSamples] = useState<number[]>([]);
  const [touchInput, setTouchInput] = useState({
    forward: false,
    backward: false,
    rotateLeft: false,
    rotateRight: false,
    shoot: false,
    broadsideLeft: false,
    broadsideRight: false,
  });
  const [pending, setPending] = useState(getPendingMatches);
  const [networkScenario, setNetworkScenarioState] = useState<NetworkScenario>(getNetworkScenario);
  const submittedMatches = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const submitMatch = useSubmitMatch();
  const rankingQuery = useRanking(config, screen === "ranking");
  const historyQuery = useMatchHistory(screen === "history");
  const [soundManager] = useState(() => new SoundManager());

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pirate-battle:mock-matches" || event.key === "pirate-battle:pending-matches") {
        setPending(getPendingMatches());
        void queryClient.invalidateQueries({ queryKey: ["ranking"] });
        void queryClient.invalidateQueries({ queryKey: ["match-history"] });
      }
      if (event.key === "pirate-battle:network-scenario") {
        setNetworkScenarioState(getNetworkScenario());
        void queryClient.invalidateQueries({ queryKey: ["ranking"] });
        void queryClient.invalidateQueries({ queryKey: ["match-history"] });
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      soundManager.dispose();
    };
  }, [queryClient, soundManager]);

  useEffect(() => {
    soundManager.setEnabled(config.soundEnabled);
    soundManager.setVolume(config.soundVolume);
    soundManager.unlock();
    if (!config.soundEnabled) {
      soundManager.stopLoop("ambient_ocean");
      soundManager.stopLoop("ambient_ship");
      return;
    }
    if (screen === "game") {
      soundManager.startLoop("ambient_ocean", 0.28);
      soundManager.startLoop("ambient_ship", 0.35);
    } else {
      soundManager.stopLoop("ambient_ocean");
      soundManager.stopLoop("ambient_ship");
    }
  }, [config.soundEnabled, config.soundVolume, screen, soundManager]);

  const showMapOverlay = screen !== "game";
  // Any screen other than the active match pauses the simulation.
  const paused = screen !== "game";

  const startNewMatch = () => {
    soundManager.unlock();
    soundManager.play("game_start", 0.8);
    setMatchInstance((instance) => instance + 1);
    setMatchSeed(createMatchSeed());
    setGameSnapshot(undefined);
    setFps(0);
    setFpsSamples([]);
    setTouchInput({
      forward: false,
      backward: false,
      rotateLeft: false,
      rotateRight: false,
      shoot: false,
      broadsideLeft: false,
      broadsideRight: false,
    });
    setOptionsReturnScreen("menu");
    setScreen("game");
  };

  const handleTelemetry = (snapshot: GameSnapshot, nextFps: number, samples: number[], result?: MatchResult) => {
    setGameSnapshot(snapshot);
    setFps(nextFps);
    setFpsSamples(samples);
    if (snapshot.phase === "finished" && screen === "game") {
      if (result && !submittedMatches.current.has(result.matchId)) {
        submittedMatches.current.add(result.matchId);
        const record: MatchRecord = { ...result, playerId: getPlayerId(), playerName: PLAYER_NAME };
        void submitMatch.mutateAsync(record).then(() => setPending(getPendingMatches())).catch(() => setPending(getPendingMatches()));
      }
      setScreen(snapshot.endReason === "player-defeated" ? "death" : "result");
    }
  };

  return (
    <main style={styles.app}>
      <div style={styles.mapBackground} aria-hidden="true">
        <GameCanvas key={matchInstance} config={config} seed={matchSeed} paused={paused} touchInput={touchInput} onTelemetry={handleTelemetry} soundManager={soundManager} />
      </div>

      <div style={showMapOverlay ? styles.overlay : styles.gameOverlay}>
        {screen === "menu" && (
          <MenuScreen
            onPlay={() => {
              soundManager.play("ui_click", 0.7);
              startNewMatch();
            }}
            networkScenario={networkScenario}
            onNetworkScenarioChange={(nextScenario) => {
              soundManager.play("ui_click", 0.6);
              setNetworkScenario(nextScenario);
              setNetworkScenarioState(nextScenario);
              void queryClient.invalidateQueries({ queryKey: ["ranking"] });
              void queryClient.invalidateQueries({ queryKey: ["match-history"] });
            }}
            onResetNetwork={() => {
              soundManager.play("ui_click", 0.6);
              resetNetworkState();
              window.location.reload();
            }}
            onNavigate={(nextScreen) => {
              soundManager.play("ui_click", 0.7);
              if (nextScreen === "options") {
                setOptionsReturnScreen("menu");
              }
              setScreen(nextScreen);
            }}
          />
        )}
        {screen === "options" && (
          <OptionsScreen
            config={config}
            onChange={(nextConfig) => {
              soundManager.play("ui_hover", 0.35);
              setConfig(nextConfig);
            }}
            onBack={() => {
              soundManager.play("ui_click", 0.7);
              setScreen(optionsReturnScreen);
            }}
          />
        )}
        {screen === "tutorial" && <TutorialScreen onBack={() => setScreen("menu")} />}
        {screen === "ranking" && (
          <RankingScreen
            config={config}
            query={rankingQuery}
            onNavigate={(nextScreen) => {
              soundManager.play("ui_click", 0.7);
              setScreen(nextScreen);
            }}
            onBack={() => {
              soundManager.play("ui_click", 0.7);
              setScreen("menu");
            }}
          />
        )}
        {screen === "history" && (
          <HistoryScreen
            query={historyQuery}
            pending={pending}
            onRetry={(record) => {
              soundManager.play("ui_click", 0.7);
              void submitMatch.mutateAsync(record).then(() => setPending(getPendingMatches())).catch(() => setPending(getPendingMatches()));
            }}
            onNavigate={(nextScreen) => {
              soundManager.play("ui_click", 0.7);
              setScreen(nextScreen);
            }}
            onBack={() => {
              soundManager.play("ui_click", 0.7);
              setScreen("menu");
            }}
          />
        )}
        {screen === "game" && (
          <GameHud
            snapshot={gameSnapshot}
            fps={fps}
            fpsSamples={fpsSamples}
            showFps={config.showFps}
            touchInput={touchInput}
            onTouchInputChange={setTouchInput}
            onPause={() => {
              soundManager.play("game_pause", 0.75);
              setScreen("pause");
            }}
            onResult={() => {
              soundManager.play("game_complete", 1);
              setScreen("result");
            }}
          />
        )}
        {screen === "pause" && (
          <PauseScreen
            onResume={() => {
              soundManager.play("game_resume", 0.75);
              setScreen("game");
            }}
            onOptions={() => {
              soundManager.play("ui_click", 0.7);
              setOptionsReturnScreen("pause");
              setScreen("options");
            }}
            onExit={() => {
              soundManager.play("ui_click", 0.7);
              setScreen("menu");
            }}
          />
        )}
        {screen === "death" && (
          <DeathScreen
            score={gameSnapshot?.score ?? 0}
            onPlayAgain={() => {
              soundManager.play("ui_click", 0.7);
              startNewMatch();
            }}
            onMenu={() => {
              soundManager.play("ui_click", 0.7);
              setScreen("menu");
            }}
          />
        )}
        {screen === "result" && (
          <ResultScreen
            score={gameSnapshot?.score ?? 0}
            reason={gameSnapshot?.endReason}
            onPlayAgain={() => {
              soundManager.play("ui_click", 0.7);
              startNewMatch();
            }}
            onMenu={() => {
              soundManager.play("ui_click", 0.7);
              setScreen("menu");
            }}
          />
        )}
      </div>
    </main>
  );
}

interface MenuScreenProps {
  onPlay: () => void;
  onNavigate: (screen: Screen) => void;
  networkScenario: NetworkScenario;
  onNetworkScenarioChange: (scenario: NetworkScenario) => void;
  onResetNetwork: () => void;
}

function MenuScreen({ onPlay, onNavigate, networkScenario, onNetworkScenarioChange, onResetNetwork }: MenuScreenProps) {
  return (
    <section style={styles.menuPanel} aria-labelledby="menu-title">
      <div style={styles.titleArt} aria-label="Pirate Battle title" />
      <p style={styles.subtitle}>Set sail. Take command.</p>
      <div style={styles.primaryActions}>
        <button style={styles.primaryButton} onClick={onPlay}>
          PLAY
        </button>
        <button style={styles.secondaryButton} onClick={() => onNavigate("options")}>
          OPTIONS
        </button>
      </div>
      <div style={styles.navRow}>
        <button style={styles.ghostButton} onClick={() => onNavigate("ranking")}>RANKING</button>
        <button style={styles.ghostButton} onClick={() => onNavigate("history")}>MATCH HISTORY</button>
        <button style={styles.ghostButton} onClick={() => onNavigate("tutorial")}>TUTORIAL</button>
      </div>
      <div style={styles.networkControls} aria-label="Network mock controls">
        <label style={styles.networkLabel} htmlFor="network-scenario">NETWORK SCENARIO</label>
        <select id="network-scenario" value={networkScenario} onChange={(event) => onNetworkScenarioChange(event.target.value as NetworkScenario)} style={styles.networkSelect}>
          {networkScenarios.map((scenario) => <option key={scenario} value={scenario}>{scenarioLabels[scenario]}</option>)}
        </select>
        <button style={styles.networkReset} onClick={onResetNetwork}>RESET MOCK DATA</button>
      </div>
      <div style={styles.controls}>
        <div style={styles.controlsBadge}>⚑</div>
        <span>Navigate the islands. Survive the battle.</span>
      </div>
    </section>
  );
}

interface OptionsScreenProps {
  config: GameConfig;
  onChange: (config: GameConfig) => void;
  onBack: () => void;
}

function OptionsScreen({ config, onChange, onBack }: OptionsScreenProps) {
  const adjustSessionDuration = (amount: number) => {
    const value = Math.min(
      GAME_LIMITS.sessionDurationSeconds.max,
      Math.max(GAME_LIMITS.sessionDurationSeconds.min, config.sessionDurationSeconds + amount),
    );
    onChange({ ...config, sessionDurationSeconds: value });
  };
  const adjustEnemySpawnInterval = (amount: number) => {
    const value = Math.min(
      GAME_LIMITS.enemySpawnIntervalSeconds.max,
      Math.max(GAME_LIMITS.enemySpawnIntervalSeconds.min, config.enemySpawnIntervalSeconds + amount),
    );
    onChange({ ...config, enemySpawnIntervalSeconds: value });
  };

  return (
    <section style={styles.panel} aria-labelledby="options-title">
      <Header title="OPTIONS" subtitle="" />
      <form style={styles.form} onSubmit={(event) => event.preventDefault()}>
        <div style={styles.optionRow}>
          <span style={styles.optionLabel}>Game session time</span>
          <div style={styles.counterWrap}>
            <button style={styles.counterButton} type="button" aria-label="Decrease session time" onClick={() => adjustSessionDuration(-10)}>−</button>
            <span style={styles.counterValue}>{config.sessionDurationSeconds} s</span>
            <button style={styles.counterButton} type="button" aria-label="Increase session time" onClick={() => adjustSessionDuration(10)}>＋</button>
          </div>
        </div>
        <div style={styles.optionRow}>
          <span style={styles.optionLabel}>Enemy spawn time</span>
          <div style={styles.counterWrap}>
            <button style={styles.counterButton} type="button" aria-label="Decrease spawn time" onClick={() => adjustEnemySpawnInterval(-1)}>−</button>
            <span style={styles.counterValue}>{config.enemySpawnIntervalSeconds} s</span>
            <button style={styles.counterButton} type="button" aria-label="Increase spawn time" onClick={() => adjustEnemySpawnInterval(1)}>＋</button>
          </div>
        </div>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            checked={config.soundEnabled}
            onChange={(event) => onChange({ ...config, soundEnabled: event.target.checked })}
          />
          <span style={styles.optionLabel}>Sound effects</span>
        </label>
        <div style={styles.sliderRow}>
          <span style={styles.optionLabel}>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.soundVolume}
            onChange={(event) => onChange({ ...config, soundVolume: Number(event.target.value) })}
            style={styles.rangeInput}
            aria-label="Volume"
            disabled={!config.soundEnabled}
          />
          <span style={styles.sliderValue}>{config.soundVolume.toFixed(2)}</span>
        </div>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            checked={config.showFps}
            onChange={(event) => onChange({ ...config, showFps: event.target.checked })}
          />
          <span style={styles.optionLabel}>Show FPS</span>
        </label>
        <label style={styles.toggleRow}>
          <input
            type="checkbox"
            checked={config.showEnemyDebug}
            onChange={(event) => onChange({ ...config, showEnemyDebug: event.target.checked })}
          />
          <span style={styles.optionLabel}>Show enemy AI debug</span>
        </label>
        <div style={styles.buttonRow}>
          <button style={styles.primaryButton} type="button" onClick={() => { saveGameConfig(config); onBack(); }}>
            MAIN MENU
          </button>
        </div>
      </form>
    </section>
  );
}

function TutorialScreen({ onBack }: { onBack: () => void }) {
  return (
    <section style={styles.panel} aria-labelledby="tutorial-title">
      <Header title="Tutorial" subtitle="Command your ship" />
      <div style={styles.tutorialGrid}>
        <div style={styles.tutorialGroup}>
          <h2 style={styles.tutorialHeading}>Keyboard</h2>
          <p style={styles.tutorialLine}><strong>W / Up</strong><span>Move forward</span></p>
          <p style={styles.tutorialLine}><strong>S / Down</strong><span>Move backward</span></p>
          <p style={styles.tutorialLine}><strong>A / Left</strong><span>Turn left</span></p>
          <p style={styles.tutorialLine}><strong>D / Right</strong><span>Turn right</span></p>
          <p style={styles.tutorialLine}><strong>Space</strong><span>Fire forward</span></p>
          <p style={styles.tutorialLine}><strong>Q / A</strong><span>Fire left broadside</span></p>
          <p style={styles.tutorialLine}><strong>E / D</strong><span>Fire right broadside</span></p>
        </div>
        <div style={styles.tutorialGroup}>
          <h2 style={styles.tutorialHeading}>Touch</h2>
          <p style={styles.tutorialLine}><strong>Arrow buttons</strong><span>Move and turn</span></p>
          <p style={styles.tutorialLine}><strong>Center cannon</strong><span>Fire forward</span></p>
          <p style={styles.tutorialLine}><strong>Side cannons</strong><span>Fire left or right</span></p>
          <p style={styles.tutorialNote}>Combine movement and firing to keep your ship moving while attacking.</p>
        </div>
      </div>
      <div style={styles.buttonRow}>
        <button style={styles.primaryButton} type="button" onClick={onBack}>MAIN MENU</button>
      </div>
    </section>
  );
}

interface DataScreenProps {
  onBack: () => void;
  onNavigate: (screen: "ranking" | "history") => void;
}

function DataTabs({ active, onNavigate }: { active: "ranking" | "history"; onNavigate: (screen: "ranking" | "history") => void }) {
  return (
    <div style={styles.tabRow}>
      <button style={active === "ranking" ? styles.tabButtonActive : styles.tabButton} onClick={() => onNavigate("ranking")}>RANKING</button>
      <button style={active === "history" ? styles.tabButtonActive : styles.tabButton} onClick={() => onNavigate("history")}>MATCH HISTORY</button>
    </div>
  );
}

function DataState({ loading, error, onRetry }: { loading: boolean; error: unknown; onRetry: () => void }) {
  if (loading) return <p style={styles.dataMessage}>Loading...</p>;
  if (error) return <div style={styles.dataMessage}><p>Unable to load data.</p><button style={styles.secondaryButton} onClick={onRetry}>RETRY</button></div>;
  return null;
}

function RankingScreen({ config, query, onBack, onNavigate }: DataScreenProps & { config: GameConfig; query: ReturnType<typeof useRanking> }) {
  const rows = query.data ? sortRanking(query.data, config) : [];
  return (
    <section style={styles.panel} aria-labelledby="ranking-title">
      <Header title="Ranking" subtitle="Top captains for this configuration" />
      <DataTabs active="ranking" onNavigate={onNavigate} />
      <DataState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      {!query.isLoading && !query.error && rows.length === 0 ? <p style={styles.dataMessage}>No scores for this configuration yet.</p> : null}
      {!query.isLoading && !query.error && rows.length > 0 ? <table style={styles.table}><thead><tr><th style={styles.tableHeader}>Captain</th><th style={styles.tableHeader}>Score</th><th style={styles.tableHeader}>Duration</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.matchId} style={index % 2 === 0 ? styles.tableRowHighlight : undefined}><td style={styles.tableCell}>{row.playerName}</td><td style={styles.tableCell}>{row.score}</td><td style={styles.tableCell}>{formatDuration(row.playedSeconds)}</td></tr>)}</tbody></table> : null}
      <div style={styles.buttonRow}><button style={styles.primaryButton} onClick={onBack}>MAIN MENU</button></div>
    </section>
  );
}

function HistoryScreen({ query, pending, onRetry, onBack, onNavigate }: DataScreenProps & { query: ReturnType<typeof useMatchHistory>; pending: ReturnType<typeof getPendingMatches>; onRetry: (record: MatchRecord) => void }) {
  const rows = [...(query.data ?? []), ...pending].filter(isHistoryRow);
  return (
    <section style={styles.panel} aria-labelledby="history-title">
      <Header title="Match History" subtitle="Your latest completed battles" />
      <DataTabs active="history" onNavigate={onNavigate} />
      <DataState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      {!query.isLoading && rows.length === 0 ? <p style={styles.dataMessage}>No completed matches yet.</p> : null}
      {!query.isLoading && rows.length > 0 ? <table style={styles.table}><thead><tr><th style={styles.tableHeader}>Date</th><th style={styles.tableHeader}>Score</th><th style={styles.tableHeader}>Duration</th><th style={styles.tableHeader}>Reason</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.matchId} style={index % 2 === 0 ? styles.tableRowHighlight : undefined}><td style={styles.tableCell}>{formatDate(row.completedAt)}</td><td style={styles.tableCell}>{row.score}</td><td style={styles.tableCell}>{formatDuration(row.playedSeconds)}</td><td style={styles.tableCell}>{isPendingMatch(row) ? <button style={styles.retryButton} onClick={() => onRetry(row)}>PENDING - RETRY</button> : formatReason(row.endReason)}</td></tr>)}</tbody></table> : null}
      <div style={styles.buttonRow}><button style={styles.primaryButton} onClick={onBack}>MAIN MENU</button></div>
    </section>
  );
}

function isHistoryRow(value: MatchRecord | ReturnType<typeof getPendingMatches>[number] | null | undefined): value is MatchRecord | ReturnType<typeof getPendingMatches>[number] {
  return Boolean(value && typeof value === "object" && typeof value.matchId === "string" && typeof value.score === "number" && typeof value.playedSeconds === "number" && typeof value.completedAt === "string");
}

function isPendingMatch(value: MatchRecord | ReturnType<typeof getPendingMatches>[number]): value is ReturnType<typeof getPendingMatches>[number] {
  return "status" in value && value.status === "pending";
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatReason(reason: MatchRecord["endReason"]): string {
  return reason === "time" ? "TIME" : "DEFEAT";
}

function GameHud({
  snapshot,
  fps,
  fpsSamples,
  showFps,
  touchInput,
  onTouchInputChange,
  onPause,
  onResult,
}: {
  snapshot?: GameSnapshot;
  fps: number;
  fpsSamples: number[];
  showFps: boolean;
  touchInput: {
    forward: boolean;
    backward: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    shoot: boolean;
    broadsideLeft: boolean;
    broadsideRight: boolean;
  };
  onTouchInputChange: (input: {
    forward: boolean;
    backward: boolean;
    rotateLeft: boolean;
    rotateRight: boolean;
    shoot: boolean;
    broadsideLeft: boolean;
    broadsideRight: boolean;
  }) => void;
  onPause: () => void;
  onResult: () => void;
}) {
  const health = snapshot?.playerHealth ?? 100;
  const score = snapshot?.score ?? 0;
  const remainingSeconds = Math.ceil(snapshot?.remainingSeconds ?? 120);
  const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
  const healthRatio = Math.max(0, Math.min(1, health / 100));

  const bindTouchButton = (key: keyof typeof touchInput, pressedValue: boolean) => ({
    onPointerDown: () => {
      const nextInput = { ...touchInput, [key]: pressedValue };
      if (key === "broadsideLeft" || key === "broadsideRight") {
        nextInput.shoot = pressedValue;
      }
      onTouchInputChange(nextInput);
    },
    onPointerUp: () => {
      const nextInput = { ...touchInput, [key]: false };
      if (key === "broadsideLeft" || key === "broadsideRight") {
        nextInput.shoot = false;
      }
      onTouchInputChange(nextInput);
    },
    onPointerLeave: () => {
      const nextInput = { ...touchInput, [key]: false };
      if (key === "broadsideLeft" || key === "broadsideRight") {
        nextInput.shoot = false;
      }
      onTouchInputChange(nextInput);
    },
    onPointerCancel: () => {
      const nextInput = { ...touchInput, [key]: false };
      if (key === "broadsideLeft" || key === "broadsideRight") {
        nextInput.shoot = false;
      }
      onTouchInputChange(nextInput);
    },
  });

  return (
    <div style={styles.hud}>
      <div style={styles.healthHud}>
        <img src="/assets/png/default/ui/hud/icon_heart.png" alt="Health" style={styles.healthIcon} />
        <div style={styles.healthBar}>
          <img src="/assets/png/default/ui/hud/health_frame.png" alt="" style={styles.healthFrame} />
          <div style={{ ...styles.healthFill, width: `${healthRatio * 100}%` }} />
          <span style={styles.healthLabel}>{health}/100</span>
        </div>
      </div>
      <div style={styles.hudCounters}>
        <div style={styles.hudCounter}>
          <img src="/assets/png/default/ui/hud/icon_score.png" alt="Score" style={styles.counterIcon} />
          <span>{score}</span>
        </div>
        <div style={styles.hudCounter}>
          <img src="/assets/png/default/ui/hud/icon_time.png" alt="Time" style={styles.counterIcon} />
          <span>{minutes}:{seconds}</span>
        </div>
      </div>
      {showFps ? <FpsDebugGraph currentFps={fps} samples={fpsSamples} /> : null}
      <button style={styles.pauseButton} aria-label="Pause" onClick={onPause}>
        <img src="/assets/png/default/ui/controls/icon_pause.png" alt="" style={styles.pauseIcon} />
      </button>
      <button style={styles.resultButton} onClick={onResult}>Finish demo</button>
      <div style={styles.touchDock} aria-label="Touch controls">
        <div style={styles.touchClusterLeft}>
          <TouchControlButton
            active={touchInput.rotateLeft}
            icon="/assets/png/default/ui/controls/icon_turn_left.png"
            label="Turn left"
            {...bindTouchButton("rotateLeft", true)}
          />
          <TouchControlButton
            active={touchInput.forward}
            icon="/assets/png/default/ui/controls/icon_forward.png"
            label="Move forward"
            {...bindTouchButton("forward", true)}
          />
          <TouchControlButton
            active={touchInput.rotateRight}
            icon="/assets/png/default/ui/controls/icon_turn_right.png"
            label="Turn right"
            {...bindTouchButton("rotateRight", true)}
          />
        </div>
        <div style={styles.touchClusterRight}>
          <TouchControlButton
            active={touchInput.broadsideLeft}
            icon="/assets/png/default/ui/controls/icon_fire_left.png"
            label="Fire left"
            {...bindTouchButton("broadsideLeft", true)}
          />
          <TouchControlButton
            active={touchInput.shoot}
            icon="/assets/png/default/ui/controls/icon_fire_front.png"
            label="Fire"
            {...bindTouchButton("shoot", true)}
          />
          <TouchControlButton
            active={touchInput.broadsideRight}
            icon="/assets/png/default/ui/controls/icon_fire_right.png"
            label="Fire right"
            {...bindTouchButton("broadsideRight", true)}
          />
        </div>
      </div>
    </div>
  );
}

function TouchControlButton({
  active,
  icon,
  label,
  ...props
}: {
  active: boolean;
  icon: string;
  label: string;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        ...styles.touchButton,
        ...(active ? styles.touchButtonActive : {}),
      }}
      {...props}
    >
      <img src={icon} alt="" style={styles.touchButtonIcon} />
    </button>
  );
}

function FpsDebugGraph({ currentFps, samples }: { currentFps: number; samples: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sorted = [...samples].sort((first, second) => first - second);
  const average = samples.length > 0
    ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length
    : 0;
  const lowPercentile = (percent: number) => {
    if (sorted.length === 0) return 0;
    const count = Math.max(1, Math.ceil(sorted.length * percent));
    return sorted.slice(0, count).reduce((sum, sample) => sum + sample, 0) / count;
  };
  const low1 = lowPercentile(0.01);
  const low01 = lowPercentile(0.001);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(7, 27, 37, 0.82)";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(255, 255, 255, 0.14)";
    context.beginPath();
    context.moveTo(8, height / 2);
    context.lineTo(width - 8, height / 2);
    context.stroke();
    if (samples.length < 2) return;
    const maxFps = Math.max(60, ...samples);
    context.strokeStyle = "#65d6a0";
    context.lineWidth = 2;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = 8 + (index / (samples.length - 1)) * (width - 16);
      const y = height - 8 - Math.min(1, sample / maxFps) * (height - 16);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }, [samples]);

  return (
    <div style={styles.fpsDebug}>
      <div style={styles.fpsLabels}>
        <strong>FPS DEBUG</strong>
        <span>NOW {currentFps.toFixed(1)}</span>
        <span>AVG {average.toFixed(1)}</span>
        <span>1% LOW {low1.toFixed(1)}</span>
        <span>0.1% LOW {low01.toFixed(1)}</span>
      </div>
      <canvas ref={canvasRef} width={240} height={72} style={styles.fpsCanvas} />
    </div>
  );
}

function DeathScreen({ score, onPlayAgain, onMenu }: { score: number; onPlayAgain: () => void; onMenu: () => void }) {
  return (
    <section style={styles.dialog} aria-labelledby="death-title">
      <h1 id="death-title" style={styles.title}>SHIP DEFEATED</h1>
      <div style={styles.resultScore}>{score}</div>
      <p style={styles.subtitle}>Your ship has sunk.</p>
      <div style={styles.primaryActions}>
        <button style={styles.primaryButton} onClick={onPlayAgain}>PLAY AGAIN</button>
        <button style={styles.secondaryButton} onClick={onMenu}>MAIN MENU</button>
      </div>
    </section>
  );
}

function PauseScreen({ onResume, onOptions, onExit }: { onResume: () => void; onOptions: () => void; onExit: () => void }) {
  return (
    <section style={styles.dialog} aria-labelledby="pause-title">
      <h1 id="pause-title" style={styles.title}>PAUSED</h1>
      <p style={styles.subtitle}>Ready when you are.</p>
      <div style={styles.primaryActions}>
        <button style={styles.primaryButton} onClick={onResume}>RESUME</button>
        <button style={styles.secondaryButton} onClick={onOptions}>OPTIONS</button>
        <button style={styles.secondaryButton} onClick={onExit}>MAIN MENU</button>
      </div>
    </section>
  );
}

function ResultScreen({ score, reason, onPlayAgain, onMenu }: { score: number; reason?: "time" | "player-defeated"; onPlayAgain: () => void; onMenu: () => void }) {
  return (
    <section style={styles.dialog} aria-labelledby="result-title">
      <h1 id="result-title" style={styles.title}>BATTLE COMPLETE</h1>
      <div style={styles.resultScore}>{score}</div>
      <p style={styles.subtitle}>{reason === "time" ? "Time up" : "Battle finished"}</p>
      <div style={styles.primaryActions}>
        <button style={styles.primaryButton} onClick={onPlayAgain}>PLAY AGAIN</button>
        <button style={styles.secondaryButton} onClick={onMenu}>MAIN MENU</button>
      </div>
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header style={styles.headerBlock}>
      <h1 id="options-title" style={styles.title}>{title}</h1>
      {subtitle ? <p style={styles.subtitle}>{subtitle}</p> : null}
    </header>
  );
}

const styles = {
  app: {
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    position: "relative" as const,
    background: "#0d526d",
    color: "#f5f7fa",
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
  mapBackground: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 0,
  },
  overlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 2,
    display: "grid",
    placeItems: "center",
    padding: "clamp(8px, 3vh, 24px)",
    overflowY: "auto" as const,
    background: "rgba(5, 25, 35, 0.22)",
  },
  gameOverlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 2,
    pointerEvents: "none" as const,
  },
  menuPanel: {
    width: "min(100%, 700px)",
    height: "auto",
    maxHeight: "calc(100vh - 16px)",
    overflowY: "auto" as const,
    boxSizing: "border-box" as const,
    padding: "clamp(18px, 5vh, 58px) clamp(20px, 7vw, 72px) clamp(18px, 3vh, 28px)",
    background: "url('/assets/png/default/ui/menu/panel_menu.png') center / 100% 100% no-repeat",
    filter: "drop-shadow(0 28px 36px rgba(0, 0, 0, 0.34))",
    display: "grid",
    justifyItems: "center",
    gap: 10,
    color: "#f7ebc5",
    position: "relative" as const,
  },
  panel: {
    width: "min(100%, 700px)",
    height: "auto",
    maxHeight: "calc(100vh - 16px)",
    overflowY: "auto" as const,
    boxSizing: "border-box" as const,
    padding: "clamp(20px, 5vh, 42px) clamp(22px, 6vw, 54px) clamp(20px, 5vh, 44px)",
    background: "url('/assets/png/default/ui/menu/panel_menu.png') center / 100% 100% no-repeat",
    filter: "drop-shadow(0 28px 36px rgba(0, 0, 0, 0.34))",
    color: "#f7ebc5",
  },
  dialog: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(calc(100% - 48px), 700px)",
    boxSizing: "border-box" as const,
    maxHeight: "calc(100vh - 16px)",
    overflowY: "auto" as const,
    padding: "clamp(22px, 5vh, 48px) clamp(24px, 7vw, 66px) clamp(22px, 4vh, 42px)",
    pointerEvents: "auto" as const,
    background: "url('/assets/png/default/ui/menu/panel_menu.png') center / 100% 100% no-repeat",
    filter: "drop-shadow(0 28px 36px rgba(0, 0, 0, 0.34))",
    color: "#f7ebc5",
    textAlign: "center" as const,
  },
  headerBlock: { display: "grid", gap: "clamp(4px, 1vh, 8px)", justifyItems: "center", marginBottom: "clamp(6px, 2vh, 12px)" },
  eyebrow: {
    margin: "0 0 8px",
    color: "#f4c95d",
    textTransform: "uppercase" as const,
    letterSpacing: "0.16em",
    fontSize: 12,
  },
  titleArt: {
    width: "min(100%, 500px)",
    height: 104,
    background: "url('/assets/png/default/ui/menu/title_pirate_battle.png') center / contain no-repeat",
    filter: "drop-shadow(0 6px 0 rgba(69, 28, 6, 0.7))",
  },
  heroTitle: { margin: "0 0 12px", fontSize: "clamp(34px, 6vw, 62px)", lineHeight: 1 },
  title: { margin: 0, fontSize: "clamp(28px, 4vw, 52px)", color: "#f7d58d", letterSpacing: "0.08em", textTransform: "uppercase" as const, textShadow: "0 3px 0 rgba(58, 26, 0, 0.8)" },
  subtitle: { color: "#f4dca4", margin: 0, textAlign: "center" as const, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase" as const },
  primaryActions: { display: "grid", gap: "clamp(6px, 1.5vh, 14px)", margin: "clamp(4px, 1vh, 8px) auto 6px", width: "100%", maxWidth: 320, justifySelf: "center" },
  secondaryButton: {
    background: "url('/assets/png/default/ui/menu/button_primary_normal.png') center / 100% 100% no-repeat",
    color: "#2a1b09",
    border: 0,
    borderRadius: 0,
    boxShadow: "none",
    fontWeight: 700,
    minHeight: "clamp(48px, 8vh, 70px)",
    fontSize: 18,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    width: "100%",
    maxWidth: 320,
    cursor: "pointer",
  },
  primaryButton: {
    background: "url('/assets/png/default/ui/menu/button_primary_normal.png') center / 100% 100% no-repeat",
    color: "#27190c",
    border: 0,
    borderRadius: 0,
    boxShadow: "none",
    fontWeight: 700,
    minHeight: "clamp(48px, 8vh, 70px)",
    fontSize: 18,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    width: "100%",
    maxWidth: 320,
    cursor: "pointer",
  },
  ghostButton: {
    background: "url('/assets/png/default/ui/menu/button_secondary_normal.png') center / 100% 100% no-repeat",
    color: "#f2dfb0",
    border: 0,
    borderRadius: 0,
    boxShadow: "none",
    fontWeight: 700,
    minHeight: "clamp(44px, 7vh, 58px)",
    padding: "0 24px",
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
  },
  navRow: { display: "flex", width: "100%", gap: 14, flexWrap: "wrap" as const, justifyContent: "center" },
  networkControls: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", maxWidth: 520, margin: "4px auto 0", alignItems: "center" },
  networkLabel: { gridColumn: "1 / -1", color: "#f2d89c", fontSize: 11, letterSpacing: "0.08em", textAlign: "center" as const },
  networkSelect: { minHeight: 34, padding: "0 8px", border: "1px solid #b7721d", background: "#f5f7fa", color: "#17252b", font: "inherit" },
  networkReset: { minHeight: 34, border: "1px solid #d58a2d", background: "rgba(213, 138, 45, 0.2)", color: "#f7d58d", fontSize: 11, fontWeight: 700, cursor: "pointer" },
  controls: { display: "grid", gap: 8, marginTop: 0, color: "#f6e3b3", fontSize: 13, textAlign: "center" as const },
  controlsBadge: { fontSize: 22, lineHeight: 1 },
  form: { display: "grid", gap: "clamp(6px, 2vh, 18px)", marginTop: "clamp(4px, 1vh, 8px)" },
  label: { display: "grid", gap: 8, color: "#f7ebc5" },
  optionRow: { display: "grid", gap: "clamp(4px, 1vh, 10px)", justifyItems: "center", padding: "clamp(4px, 1.5vh, 12px) 0" },
  optionLabel: { color: "#f2d89c", fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" as const },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "5px 0", cursor: "pointer" },
  sliderRow: { display: "grid", gap: 8, justifyItems: "center", padding: "6px 0" },
  sliderValue: { color: "#f9e7b3", fontWeight: 700, fontSize: 16 },
  rangeInput: { width: "min(100%, 280px)", accentColor: "#d58a2d" },
  counterWrap: { display: "flex", alignItems: "center", gap: 12, justifyContent: "center" },
  counterValue: { minWidth: 112, textAlign: "center" as const, color: "#f9e7b3", fontWeight: 700, fontSize: 20 },
  counterButton: { width: 34, height: 34, borderRadius: "50%", border: "3px solid #b7721d", background: "linear-gradient(180deg, #f7d683, #d58a2d)", color: "#2d1d0d", fontWeight: 700, fontSize: 20, cursor: "pointer" },
  input: { padding: "12px 14px", font: "inherit", color: "#17252b", background: "#f5f7fa", border: 0 },
  buttonRow: { display: "flex", width: "100%", justifyContent: "center", gap: "clamp(6px, 1.5vh, 12px)", marginTop: "clamp(6px, 2vh, 14px)", flexWrap: "wrap" as const },
  tutorialGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "clamp(12px, 3vh, 24px)", marginTop: "clamp(4px, 1vh, 10px)" },
  tutorialGroup: { display: "grid", gap: "clamp(4px, 1vh, 8px)" },
  tutorialHeading: { margin: 0, color: "#f4c95d", fontSize: "clamp(15px, 2vh, 20px)", textTransform: "uppercase" as const, letterSpacing: "0.08em" },
  tutorialLine: { display: "flex", justifyContent: "space-between", gap: 12, margin: 0, padding: "clamp(4px, 1vh, 8px) 0", borderBottom: "1px solid rgba(242, 216, 156, 0.2)", color: "#f2d89c", fontSize: "clamp(12px, 1.7vh, 15px)" },
  tutorialLineStrong: { color: "#f9e7b3" },
  tutorialNote: { margin: "clamp(6px, 2vh, 14px) 0 0", color: "#f2d89c", fontSize: "clamp(12px, 1.7vh, 15px)", lineHeight: 1.4 },
  tabRow: { display: "flex", justifyContent: "center", gap: 14, margin: "14px 0 10px" },
  tabButton: { background: "url('/assets/png/default/ui/menu/button_secondary_normal.png') center / 100% 100% no-repeat", border: 0, borderRadius: 0, color: "#f5d688", minHeight: 58, minWidth: 180, padding: "0 20px", textTransform: "uppercase" as const, fontWeight: 700 },
  tabButtonActive: { background: "url('/assets/png/default/ui/menu/button_primary_normal.png') center / 100% 100% no-repeat", border: 0, borderRadius: 0, color: "#2b1d0d", minHeight: 58, minWidth: 180, padding: "0 20px", textTransform: "uppercase" as const, fontWeight: 700 },
  table: { width: "100%", borderCollapse: "collapse" as const, marginTop: 14, textAlign: "left" as const, color: "#eef7fb" },
  tableHeader: { color: "#f0d48d", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" as const, padding: "10px 12px" },
  tableRowHighlight: { background: "rgba(255,255,255,0.04)" },
  tableCell: { borderTop: "1px solid rgba(255,255,255,0.08)", padding: "12px 10px", fontSize: 14 },
  dataMessage: { minHeight: 120, display: "grid", placeItems: "center", alignContent: "center", gap: 12, textAlign: "center" as const, color: "#f2d89c" },
  retryButton: { border: "1px solid #f0c963", background: "rgba(240, 201, 99, 0.12)", color: "#f7d58d", padding: "6px 8px", cursor: "pointer", fontWeight: 700, fontSize: 11 },
  hud: { position: "absolute" as const, inset: 0, pointerEvents: "none" as const },
  healthHud: {
    position: "absolute" as const,
    top: 18,
    left: 24,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  healthIcon: { width: 38, height: 38, objectFit: "contain" as const, filter: "drop-shadow(0 3px 2px rgba(0,0,0,0.35))" },
  healthBar: { position: "relative" as const, width: 256, height: 48 },
  healthFill: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    height: "100%",
    background: "url('/assets/png/default/ui/hud/health_fill_green.png') left center / 256px 48px no-repeat",
    transition: "width 180ms ease-out",
    zIndex: 1,
  },
  healthFrame: { position: "absolute" as const, inset: 0, width: "100%", height: "100%", zIndex: 0 },
  healthLabel: {
    position: "absolute" as const,
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#fff6d5",
    fontSize: 13,
    fontWeight: 700,
    textShadow: "0 2px 2px rgba(0,0,0,0.75)",
    zIndex: 2,
  },
  hudCounters: { position: "absolute" as const, top: 18, right: 72, display: "flex", gap: 12, alignItems: "center" },
  hudCounter: {
    width: 160,
    height: 56,
    background: "url('/assets/png/default/ui/hud/counter_panel.png') center / 100% 100% no-repeat",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: "#f9e5a8",
    fontSize: 17,
    fontWeight: 700,
    textShadow: "0 2px 2px rgba(0,0,0,0.75)",
  },
  counterIcon: { width: 28, height: 28, objectFit: "contain" as const },
  fpsDebug: { position: "absolute" as const, top: 82, left: 16, padding: 8, background: "rgba(7, 27, 37, 0.82)", pointerEvents: "none" as const },
  fpsLabels: { display: "flex", gap: 10, alignItems: "center", color: "#c7d9df", fontFamily: "monospace", fontSize: 10 },
  fpsCanvas: { display: "block" as const, width: 240, height: 72, marginTop: 6 },
  pauseButton: { position: "absolute" as const, top: 14, right: 14, pointerEvents: "auto" as const, background: "url('/assets/png/default/ui/controls/button_round_normal.png') center / 100% 100% no-repeat", border: 0, width: 64, height: 64, padding: 0, display: "grid", placeItems: "center" },
  pauseIcon: { width: 32, height: 32, objectFit: "contain" as const },
  resultButton: { position: "absolute" as const, top: 86, right: 18, pointerEvents: "auto" as const, background: "linear-gradient(180deg, #f3c760, #cf8a2a)", border: "4px solid #b7721d", borderRadius: 999, color: "#25180a", fontWeight: 700, padding: "8px 12px" },
  touchDock: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    padding: "0 12px 18px",
    pointerEvents: "none" as const,
  },
  touchClusterLeft: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    pointerEvents: "auto" as const,
  },
  touchClusterRight: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    pointerEvents: "auto" as const,
  },
  touchButton: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    border: "4px solid #7d4b14",
    background: "url('/assets/png/default/ui/controls/button_round_normal.png') center / cover no-repeat",
    boxShadow: "inset 0 0 0 2px rgba(255, 220, 130, 0.2), 0 6px 0 rgba(77, 47, 13, 0.35)",
    display: "grid",
    placeItems: "center",
    padding: 0,
    cursor: "pointer",
    touchAction: "none" as const,
    userSelect: "none" as const,
  },
  touchButtonActive: {
    background: "url('/assets/png/default/ui/controls/button_round_pressed.png') center / cover no-repeat",
    transform: "translateY(2px)",
    boxShadow: "inset 0 0 0 2px rgba(255, 220, 130, 0.2), 0 3px 0 rgba(77, 47, 13, 0.35)",
  },
  touchButtonIcon: {
    width: 30,
    height: 30,
    objectFit: "contain" as const,
    filter: "drop-shadow(0 2px 0 rgba(0, 0, 0, 0.35))",
  },
  resultGrid: { display: "grid", gap: 14, marginTop: 24, color: "#c7d9df" },
  resultScore: { fontSize: "clamp(36px, 5vw, 72px)", color: "#f6d582", fontWeight: 700, margin: "10px 0 8px", textShadow: "0 4px 0 rgba(55, 26, 0, 0.7)" },
};

export default App;
