import { Assets, Sprite, type Texture } from "pixi.js";
import type { Vector2 } from "../model/gameTypes";

const DAMAGE_STAGE_COUNT = 4;
const DAMAGE_STAGE_OFFSET = 6;

export type BoatRendererOptions = {
  baseShipNumber: number;
  scale?: number;
} | {
  assetName: "dinghy_large" | "dinghy_small";
  scale?: number;
};

export class BoatRenderer {
  public readonly sprite: Sprite;
  private readonly textures: Map<string, Texture>;
  private readonly baseTextureKey: string;

  private constructor(
    sprite: Sprite,
    textures: Map<string, Texture>,
    baseTextureKey: string,
  ) {
    this.sprite = sprite;
    this.textures = textures;
    this.baseTextureKey = baseTextureKey;
  }

  public static async create(options: BoatRendererOptions): Promise<BoatRenderer> {
    const textures = new Map<string, Texture>();
    const isDinghy = "assetName" in options;
    const stageCount = isDinghy ? 3 : DAMAGE_STAGE_COUNT;
    for (let damageStage = 0; damageStage < stageCount; damageStage += 1) {
      const textureKey = isDinghy
        ? `${options.assetName}_${damageStage + 1}`
        : String(options.baseShipNumber + damageStage * DAMAGE_STAGE_OFFSET);
      const texturePath = isDinghy
        ? `/assets/png/default/ships/${textureKey}.png`
        : `/assets/png/default/ships/ship_${textureKey}.png`;
      textures.set(textureKey, await Assets.load(texturePath));
    }

    const baseTextureKey = isDinghy ? `${options.assetName}_1` : String(options.baseShipNumber);
    const sprite = new Sprite(textures.get(baseTextureKey));
    sprite.anchor.set(0.5);
    sprite.scale.set(options.scale ?? 0.7);

    return new BoatRenderer(sprite, textures, baseTextureKey);
  }

  public update(
    position: Vector2,
    rotation: number,
    health: number,
    maxHealth: number,
  ): void {
    const healthRatio = Math.max(0, Math.min(1, health / Math.max(maxHealth, 1)));
    let damageStage = 0;
    if (healthRatio <= 0.05){
        damageStage = 3;
    }
    else if (healthRatio <= 0.33) {
      damageStage = 2;
    } else if (healthRatio <= 0.66) {
      damageStage = 1;
    }

    const textureKey = this.baseTextureKey.includes("dinghy")
      ? `${this.baseTextureKey.split("_").slice(0, 2).join("_")}_${Math.min(3, damageStage + 1)}`
      : String(Number(this.baseTextureKey) + damageStage * DAMAGE_STAGE_OFFSET);
    const texture = this.textures.get(textureKey) ?? this.textures.get(this.baseTextureKey);
    if (texture && this.sprite.texture !== texture) {
      this.sprite.texture = texture;
    }

    this.sprite.position.set(position.x, position.y);
    this.sprite.rotation = rotation;
  }

  public destroy(): void {
    const textureKey = this.baseTextureKey.includes("dinghy")
      ? `${this.baseTextureKey.split("_").slice(0, 2).join("_")}_3`
      : String(Number(this.baseTextureKey) + 3 * DAMAGE_STAGE_OFFSET);
    const texture = this.textures.get(textureKey) ?? this.textures.get(this.baseTextureKey);
    if (texture && this.sprite.texture !== texture) {
      this.sprite.texture = texture;
    };
  }
}