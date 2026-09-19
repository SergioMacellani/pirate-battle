import { Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { EnemySnapshot } from "../model/gameTypes";
import { BoatRenderer } from "./BoatRenderer";

interface HealthTextures {
  frame: Texture;
  green: Texture;
  red: Texture;
}

interface EnemyVisual {
  boat: BoatRenderer;
  healthBar: Container;
  healthFill: Sprite;
  healthFrame: Sprite;
  healthGreenTexture?: Texture;
  healthRedTexture?: Texture;
  routeDebug: Graphics;
  debugText: Text;
  deathSprite: Sprite;
}

export class EnemyRenderer {
  private readonly visuals = new Map<string, EnemyVisual>();
  private readonly pendingBoats = new Map<string, Promise<[BoatRenderer, HealthTextures | undefined]>>();
  private readonly latestEnemies = new Map<string, EnemySnapshot>();
  private healthTexturesPromise?: Promise<HealthTextures | undefined>;
  private lastDebugRender = 0;
  private destroyed = false;

  public update(
    enemies: EnemySnapshot[],
    playerPosition: { x: number; y: number },
    world: Container,
    showEnemyDebug: boolean,
  ): void {
    if (this.destroyed) {
      return;
    }
    const now = performance.now();
    const updateDebug = showEnemyDebug && now - this.lastDebugRender >= 100;
    if (updateDebug) {
      this.lastDebugRender = now;
    }
    this.latestEnemies.clear();
    for (const enemy of enemies) {
      this.latestEnemies.set(enemy.id, enemy);
    }

    for (const [id, visual] of this.visuals) {
      if (!this.latestEnemies.has(id)) {
        world.removeChild(
          visual.boat.sprite,
          visual.healthBar,
          visual.routeDebug,
          visual.debugText,
          visual.deathSprite,
        );
        this.visuals.delete(id);
      }
    }

    for (const enemy of enemies) {
      const visual = this.visuals.get(enemy.id);
      if (visual) {
        this.renderEnemy(visual, enemy, playerPosition, updateDebug, showEnemyDebug);
        continue;
      }

      if (this.pendingBoats.has(enemy.id)) {
        continue;
      }

      const pendingBoat = Promise.all([
        enemy.asset === "ship"
          ? BoatRenderer.create({ baseShipNumber: enemy.baseShipNumber })
          : BoatRenderer.create({ assetName: enemy.asset }),
        this.loadHealthTextures(),
      ]);
      this.pendingBoats.set(enemy.id, pendingBoat);
      void pendingBoat.then(([boat, healthTextures]) => {
        this.pendingBoats.delete(enemy.id);
        const latestEnemy = this.latestEnemies.get(enemy.id);
        if (this.destroyed || !latestEnemy) {
          return;
        }

        const healthBar = new Container();
        const healthFill = new Sprite();
        const healthFrame = new Sprite();
        if (healthTextures) {
          healthFill.texture = healthTextures.green;
          healthFrame.texture = healthTextures.frame;
        }
        healthFill.width = 80;
        healthFill.height = 20;
        healthFrame.width = 80;
        healthFrame.height = 20;
        healthBar.addChild(healthFrame, healthFill);
        const debugText = new Text("", {
          fill: 0xffffff,
          fontFamily: "monospace",
          fontSize: 11,
          stroke: 0x17242b,
          strokeThickness: 3,
        });
        debugText.anchor.set(0.5, 1);
        const routeDebug = new Graphics();
        const deathSprite = new Sprite();
        deathSprite.anchor.set(0.5);
        deathSprite.visible = false;
        const nextVisual = {
          boat,
          healthBar,
          healthFill,
          healthFrame,
          healthGreenTexture: healthTextures?.green,
          healthRedTexture: healthTextures?.red,
          routeDebug,
          debugText,
          deathSprite,
        };
        this.visuals.set(enemy.id, nextVisual);
        world.addChild(boat.sprite, routeDebug, deathSprite, healthBar, debugText);
        this.renderEnemy(nextVisual, latestEnemy, playerPosition, true, showEnemyDebug);
      });
    }
  }

  private renderEnemy(
    visual: EnemyVisual,
    enemy: EnemySnapshot,
    playerPosition: { x: number; y: number },
    updateDebug: boolean,
    showEnemyDebug: boolean,
  ): void {
    visual.boat.update(
      { x: enemy.x, y: enemy.y },
      enemy.rotation,
      enemy.sinking ? 0 : enemy.health,
      enemy.maxHealth,
    );

    const healthRatio = enemy.defeated
      ? 0
      : Math.max(0, Math.min(1, enemy.health / Math.max(enemy.maxHealth, 1)));
    const sinkingOffset = enemy.sinkProgress * 24;
    const baseScale = enemy.asset === "dinghy_large"
      ? 1.25
      : enemy.asset === "dinghy_small"
        ? 1.1
        : 0.7;
    const sinkingScale = baseScale * (1 - enemy.sinkProgress * 0.35);
    visual.boat.sprite.y = enemy.y + sinkingOffset;
    visual.boat.sprite.alpha = 1 - enemy.sinkProgress;
    visual.boat.sprite.scale.set(sinkingScale);

    visual.deathSprite.visible = false;

    visual.healthBar.position.set(enemy.x - 40, enemy.y - 40 + sinkingOffset);
    visual.healthBar.alpha = 1 - enemy.sinkProgress;
    const fillTexture = healthRatio > 0.33
      ? visual.healthGreenTexture
      : visual.healthRedTexture;
    if (fillTexture) {
      visual.healthFill.texture = fillTexture;
    }
    visual.healthFill.width = 80 * healthRatio;
    visual.routeDebug.visible = showEnemyDebug;
    visual.debugText.visible = showEnemyDebug;

    if (!showEnemyDebug || !updateDebug) {
      return;
    }

    const routeColor = enemy.sinking
      ? 0x9aa4aa
      : enemy.blockedBy
        ? 0xe56b6f
      : enemy.positioned
        ? 0xf5c451
        : enemy.moving
          ? 0x65d6a0
          : 0xe56b6f;
    visual.routeDebug.clear();
    visual.routeDebug.lineStyle(2, routeColor, 0.7);
    visual.routeDebug.moveTo(enemy.x, enemy.y);
    visual.routeDebug.lineTo(playerPosition.x, playerPosition.y);
    visual.routeDebug.beginFill(routeColor, 0.8);
    visual.routeDebug.drawCircle(playerPosition.x, playerPosition.y, 4);
    visual.routeDebug.endFill();
    if (enemy.blockedBy) {
      visual.routeDebug.lineStyle(3, 0xe56b6f, 0.95);
      visual.routeDebug.drawRect(
        enemy.blockedBy.x,
        enemy.blockedBy.y,
        enemy.blockedBy.width,
        enemy.blockedBy.height,
      );
    }
    visual.routeDebug.alpha = Math.max(0, 1 - enemy.sinkProgress);

    const distance = Math.hypot(
      enemy.x - playerPosition.x,
      enemy.y - playerPosition.y,
    );
    const state = enemy.sinking
      ? "AFUNDANDO"
      : enemy.blockedBy
        ? "BLOQUEADO: ILHA"
      : enemy.positioned
        ? "POSICIONADO"
        : enemy.moving
          ? distance < 192
            ? "RECUANDO"
            : "APROXIMANDO"
          : "PARADO";
    const enemyLabel = enemy.asset === "dinghy_large"
      ? "CHASER LARGE"
      : enemy.asset === "dinghy_small"
        ? "CHASER SMALL"
        : "SHOOTER";
    visual.debugText.text = `${enemyLabel} | ${Math.round(distance)}px | ${state}`;
    visual.debugText.position.set(enemy.x, enemy.y - 48 + sinkingOffset);
    visual.debugText.alpha = Math.max(0, 1 - enemy.sinkProgress);
  }

  private loadHealthTextures(): Promise<HealthTextures | undefined> {
    if (!this.healthTexturesPromise) {
      this.healthTexturesPromise = Promise.all([
        Assets.load<Texture>("/assets/png/default/ui/hud/enemy_health_frame.png"),
        Assets.load<Texture>("/assets/png/default/ui/hud/enemy_health_fill_green.png"),
        Assets.load<Texture>("/assets/png/default/ui/hud/enemy_health_fill_red.png"),
      ]).then(([frame, green, red]) => ({ frame, green, red })).catch(() => undefined);
    }
    return this.healthTexturesPromise;
  }

  public destroy(world: Container): void {
    this.destroyed = true;
    for (const visual of this.visuals.values()) {
      world.removeChild(
        visual.boat.sprite,
        visual.healthBar,
        visual.routeDebug,
        visual.debugText,
        visual.deathSprite,
      );
    }
    this.visuals.clear();
    this.pendingBoats.clear();
    this.latestEnemies.clear();
  }
}