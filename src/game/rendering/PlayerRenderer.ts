import type { Vector2 } from "../model/gameTypes";
import { BoatRenderer } from "./BoatRenderer";

const PLAYER_BASE_SHIP_NUMBER = 1;

export class PlayerRenderer {
  private constructor(private readonly boat: BoatRenderer) {}

  public get sprite() {
    return this.boat.sprite;
  }

  public static async create(): Promise<PlayerRenderer> {
    const boat = await BoatRenderer.create({ baseShipNumber: PLAYER_BASE_SHIP_NUMBER });
    return new PlayerRenderer(boat);
  }

  public update(
    position: Vector2,
    rotation: number,
    health: number,
    maxHealth: number,
  ): void {
    this.boat.update(position, rotation, health, maxHealth);
  }
}
