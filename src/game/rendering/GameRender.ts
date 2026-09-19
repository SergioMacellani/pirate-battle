import { Application, Assets, Container, Sprite, type Texture } from "pixi.js";
import type { GameSnapshot, ImpactSnapshot, MatchResult, ProjectileSnapshot } from "../model/gameTypes";
import type { GameConfig } from "../config/gameConfig";
import { mergeTouchInput, type MobileInputState } from "../input/mobileControls";
import { GameSimulation } from "../simulation/GameSimulation";
import { MapRenderer } from "./MapRenderer";
import { EnemyRenderer } from "./EnemyRenderer";
import { PlayerRenderer } from "./PlayerRenderer";
import { clampFrameDelta } from "./frameTiming";
import { installGameTestBridge, removeGameTestBridge, updateControlledSimulation } from "../testBridge";
import type { SoundManager } from "../audio/SoundManager";

async function awaitTexture(path: string): Promise<Texture | undefined> {
  try {
    return await Assets.load(path);
  } catch {
    return undefined;
  }
}

export class GameRenderer {
  private app?: Application;
  private readonly world: Container = new Container();
  private map?: MapRenderer;
  private player?: PlayerRenderer;
  private readonly simulation: GameSimulation;
  private keys: Record<string, boolean> = {};
  private touchInput: Partial<MobileInputState> = {};
  private projectileSprites = new Map<string, Sprite>();
  private projectileTexture?: Texture;
  private projectileTexturePromise?: Promise<Texture | undefined>;
  private impactTextures?: Texture[];
  private impactTexturesPromise?: Promise<Texture[]>;
  private impactSprites = new Map<string, Sprite>();
  private readonly enemies = new EnemyRenderer();
  private rafId?: number;
  private lastTime?: number;
  private destroyed = false;
  private simulationStarted = false;
  private pendingPaused: boolean;
  private telemetryListener?: (snapshot: GameSnapshot, fps: number, samples: number[], result?: MatchResult) => void;
  private telemetryElapsed = 0;
  private telemetryFrames = 0;
  private currentFps = 0;
  private fpsSamples: number[] = [];
  private controlledClock = false;
  private lastSnapshot?: GameSnapshot;
  private soundManager?: SoundManager;
  private testBridge?: Window["__PIRATE_BATTLE_TEST__"];
  private resizeObserver?: ResizeObserver;

  public setTelemetryListener(listener: (snapshot: GameSnapshot, fps: number, samples: number[], result?: MatchResult) => void): void {
    this.telemetryListener = listener;
  }

  constructor(
    private readonly config: GameConfig,
    private readonly seed: number,
    initialPaused: boolean,
    soundManager?: SoundManager,
  ) {
    this.simulation = new GameSimulation(config);
    this.pendingPaused = initialPaused;
    this.soundManager = soundManager;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.update = this.update.bind(this);
    this.rafLoop = this.rafLoop.bind(this);
  }

  setPaused(paused: boolean): void {
    this.pendingPaused = paused;
    if (!this.simulationStarted) {
      return;
    }
    if (paused) {
      this.simulation.pause();
    } else {
      this.simulation.resume();
    }
  }

  setTouchInput(input: Partial<MobileInputState>): void {
    this.touchInput = input;
  }

  setSoundManager(soundManager: SoundManager | undefined): void {
    this.soundManager = soundManager;
  }

  async initialize(container: HTMLElement): Promise<void> {
    if (this.destroyed) {
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.app = new Application({
      width,
      height,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
      backgroundColor: 0x4aa9c2,
    });
    this.app.ticker.stop();

    const map = await MapRenderer.create(width, height, this.seed);
    const player = await PlayerRenderer.create();

    if (this.destroyed || !this.app) {
      return;
    }

    this.map = map;
    this.player = player;
    this.player.update({ x: width / 2, y: height / 2 }, 0, 100, 100);
    this.simulation.setCollisionRects(map.getCollisionRects());
    this.simulation.setStructureCollisionRects(map.getStructureCollisionRects());
    this.world.addChild(this.map.container, this.player.sprite);
    this.app.stage.addChild(this.world);
    this.simulation.setArenaSize(width, height);
    this.simulation.start();
    this.simulationStarted = true;
    this.testBridge = {
      getSnapshot: () => this.simulation.getSnapshot(),
      setInput: (input) => this.simulation.setInput(input),
      damagePlayer: (amount) => {
        this.simulation.damagePlayer(amount);
        this.publishSnapshot(0.25, 0.016, true);
      },
      setPaused: (paused) => this.setPaused(paused),
      setControlledClock: (controlled) => { this.controlledClock = controlled; },
      reset: () => {
        this.simulation.reset();
        this.simulation.start();
        this.publishSnapshot(0.25, 0.016, true);
      },
      setSpawningEnabled: (enabled) => this.simulation.setSpawningEnabled(enabled),
      advance: (seconds) => {
        if (!this.controlledClock) return;
        updateControlledSimulation(this.simulation, seconds);
        this.publishSnapshot(seconds, seconds > 0 ? seconds : 0.016, true);
      },
    };
    installGameTestBridge(this.testBridge);
    if (this.pendingPaused) {
      this.simulation.pause();
    }

    const canvas = this.app.view as HTMLCanvasElement;
    canvas.style.display = "block";
    container.appendChild(canvas);
    this.app.renderer.resize(width, height);
    this.app.renderer.render(this.app.stage);

    this.resizeObserver = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size) return;
      this.resize(size.width, size.height);
    });
    this.resizeObserver.observe(container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.rafLoop);
  }

  private resize(width: number, height: number): void {
    if (!this.app || !this.map || !this.player || width <= 0 || height <= 0) {
      return;
    }

    const currentWidth = this.app.renderer.width / this.app.renderer.resolution;
    const currentHeight = this.app.renderer.height / this.app.renderer.resolution;
    if (currentWidth === width && currentHeight === height) {
      return;
    }

    this.app.renderer.resize(width, height);
    this.map.resize(width, height);
    this.simulation.setCollisionRects(this.map.getCollisionRects());
    this.simulation.setStructureCollisionRects(this.map.getStructureCollisionRects());
    this.simulation.resizeArena(width, height);
    const snapshot = this.simulation.getSnapshot();
    this.player.update(
      snapshot.playerPosition,
      snapshot.playerRotation,
      snapshot.playerHealth,
      snapshot.config.player.maxHealth,
    );
    this.app.renderer.render(this.app.stage);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const key = e.code === "Space" ? "space" : e.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase()) || e.code === "Space") {
      e.preventDefault();
    }
    this.keys[key] = true;
  }

  private onKeyUp(e: KeyboardEvent): void {
    const key = e.code === "Space" ? "space" : e.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase()) || e.code === "Space") {
      e.preventDefault();
    }
    this.keys[key] = false;
  }

  private update(deltaSeconds: number): void {
    if (this.controlledClock) return;
    if (!this.player) return;

    const safeDelta = clampFrameDelta(deltaSeconds);
    const mergedInput = mergeTouchInput(
      {
        forward: Boolean(this.keys["w"] || this.keys["arrowup"]),
        backward: Boolean(this.keys["s"] || this.keys["arrowdown"]),
        rotateLeft: Boolean((this.keys["a"] && !this.keys["space"] && !this.keys[" "]) || this.keys["arrowleft"]),
        rotateRight: Boolean((this.keys["d"] && !this.keys["space"] && !this.keys[" "]) || this.keys["arrowright"]),
        shoot: Boolean(this.keys["space"] || this.keys[" "]),
        broadsideLeft: Boolean(this.keys["q"] || this.keys["a"]),
        broadsideRight: Boolean(this.keys["e"] || this.keys["d"]),
      },
      this.touchInput,
    );

    this.simulation.setInput(mergedInput);

    this.simulation.update(safeDelta);
    this.publishSnapshot(deltaSeconds, safeDelta);
  }

  private publishSnapshot(deltaSeconds: number, safeDelta: number, forceTelemetry = false): void {
    if (!this.player) return;
    const snapshot = this.simulation.getSnapshot();
    this.handleAudio(snapshot);
    this.telemetryElapsed += deltaSeconds;
    this.telemetryFrames += 1;
    if (deltaSeconds > 0) {
      this.fpsSamples.push(1 / deltaSeconds);
      if (this.fpsSamples.length > 300) {
        this.fpsSamples.shift();
      }
    }
    if (forceTelemetry || this.telemetryElapsed >= 0.25) {
      this.currentFps = this.telemetryFrames / this.telemetryElapsed;
      this.telemetryElapsed = 0;
      this.telemetryFrames = 0;
      this.telemetryListener?.(snapshot, this.currentFps, [...this.fpsSamples], this.simulation.getResult());
    }

    this.player.update(
      snapshot.playerPosition,
      snapshot.playerRotation,
      snapshot.playerHealth,
      snapshot.config.player.maxHealth,
    );
    void this.syncProjectiles(snapshot.projectiles);
    void this.syncImpacts(snapshot.impacts);
    void this.enemies.update(
      snapshot.enemies,
      snapshot.playerPosition,
      this.world,
      this.config.showEnemyDebug,
    );
    this.map?.update(safeDelta, snapshot.playerPosition, snapshot.playerRotation);
    this.app?.renderer.render(this.app.stage);
  }

  private handleAudio(snapshot: GameSnapshot): void {
    const sound = this.soundManager;
    if (!sound) {
      return;
    }

    const previous = this.lastSnapshot;
    if (previous) {
      const playerShots = snapshot.shotsFired - previous.shotsFired;
      const broadsideShots = snapshot.broadsideShotsFired - previous.broadsideShotsFired;
      if (playerShots > 0) {
        sound.play(broadsideShots > 0 ? "player_broadside" : "player_fire", broadsideShots > 0 ? 0.7 : 0.8);
      }

      const enemyProjectiles = snapshot.projectiles.filter((projectile) => projectile.owner === "enemy").length -
        previous.projectiles.filter((projectile) => projectile.owner === "enemy").length;
      if (enemyProjectiles > 0) {
        sound.play("enemy_fire", 0.55);
      }

      const defeatedEnemies = snapshot.enemies.filter((enemy) => enemy.defeated).length -
        previous.enemies.filter((enemy) => enemy.defeated).length;
      if (defeatedEnemies > 0) {
        sound.play("enemy_destroyed", 0.8);
      }

      if (snapshot.playerHealth < previous.playerHealth) {
        sound.play(Math.random() < 0.5 ? "player_hit" : "ship_collision", 0.9);
      }

      if (snapshot.phase === "paused" && previous.phase === "running") {
        sound.play("game_pause", 0.75);
      }

      if (snapshot.phase === "running" && previous.phase === "paused") {
        sound.play("game_resume", 0.75);
      }

      if (snapshot.phase === "finished" && previous.phase !== "finished") {
        sound.play(snapshot.endReason === "player-defeated" ? "game_over" : "game_complete", 1);
      }
    }

    if (snapshot.phase === "running" && !previous) {
      sound.startLoop("ambient_ocean", 0.28);
      sound.startLoop("ambient_ship", 0.35);
    }

    if (snapshot.phase !== "running" && previous?.phase === "running") {
      sound.stopLoop("ambient_ship");
      sound.stopLoop("ambient_ocean");
    }

    if (snapshot.phase === "running" && previous?.phase !== "running") {
      sound.startLoop("ambient_ocean", 0.28);
      sound.startLoop("ambient_ship", 0.35);
    }

    this.lastSnapshot = snapshot;
  }

  private async syncImpacts(impacts: ImpactSnapshot[]): Promise<void> {
    const ids = new Set(impacts.map((impact) => impact.id));
    for (const [id, sprite] of [...this.impactSprites]) {
      if (!ids.has(id)) {
        this.world.removeChild(sprite);
        this.impactSprites.delete(id);
      }
    }

    if (!this.impactTextures && !this.impactTexturesPromise) {
      this.impactTexturesPromise = Promise.all(
        [1, 2, 3].map((frame) =>
          Assets.load<Texture>(`/assets/png/default/effects/explosion_${frame}.png`),
        ),
      ).then((textures) => {
        this.impactTextures = textures;
        return textures;
      });
    }

    const textures = this.impactTextures;
    if (!textures) {
      return;
    }

    for (const impact of impacts) {
      let sprite = this.impactSprites.get(impact.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5);
        this.world.addChild(sprite);
        this.impactSprites.set(impact.id, sprite);
      }
      const frame = Math.min(textures.length - 1, Math.floor(impact.progress * textures.length));
      sprite.texture = textures[frame];
      sprite.position.set(impact.x, impact.y);
      sprite.alpha = 1 - impact.progress;
      sprite.scale.set(0.55 + impact.progress * 0.3);
    }
  }

  private syncProjectiles(projectiles: ProjectileSnapshot[]): void {
    const ids = new Set(projectiles.map((projectile) => projectile.id));

    for (const [id, sprite] of [...this.projectileSprites]) {
      if (!ids.has(id)) {
        this.world.removeChild(sprite);
        this.projectileSprites.delete(id);
      }
    }

    for (const projectile of projectiles) {
      let sprite = this.projectileSprites.get(projectile.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5);
        this.world.addChild(sprite);
        this.projectileSprites.set(projectile.id, sprite);
      }

      if (this.projectileTexture) {
        sprite.texture = this.projectileTexture;
      } else if (!this.projectileTexturePromise) {
        this.projectileTexturePromise = awaitTexture("/assets/png/retina/ship_parts/cannon_ball.png");
        void this.projectileTexturePromise.then((texture) => {
          this.projectileTexture = texture;
          if (!texture) {
            return;
          }
          for (const projectileSprite of this.projectileSprites.values()) {
            projectileSprite.texture = texture;
          }
        });
      }

      sprite.position.set(projectile.x, projectile.y);
      sprite.rotation = projectile.rotation;
      sprite.scale.set(0.8);
    }
  }

  private rafLoop(now: number): void {
    const last = this.lastTime ?? now;
    const dt = (now - last) / 1000;
    this.lastTime = now;
    this.update(dt);
    this.rafId = requestAnimationFrame(this.rafLoop);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.keys = {};
    for (const sprite of this.projectileSprites.values()) {
      this.world.removeChild(sprite);
    }
    for (const sprite of this.impactSprites.values()) {
      this.world.removeChild(sprite);
    }
    this.projectileSprites.clear();
    this.impactSprites.clear();
    this.enemies.destroy(this.world);
    if (window.__PIRATE_BATTLE_TEST__ === this.testBridge) {
      removeGameTestBridge();
    }
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);

    if (this.app) {
      this.app.destroy(true, {
        children: true,
        texture: false,
        baseTexture: false,
      });
    }
  }
}