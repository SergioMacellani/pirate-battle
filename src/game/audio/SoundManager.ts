export type GameAudioCue =
  | "game_start"
  | "game_complete"
  | "game_over"
  | "game_pause"
  | "game_resume"
  | "ui_click"
  | "ui_hover"
  | "player_fire"
  | "player_broadside"
  | "enemy_fire"
  | "player_hit"
  | "ship_collision"
  | "explosion"
  | "enemy_destroyed"
  | "ambient_ocean"
  | "ambient_ship";

const SOUND_FILES: Record<GameAudioCue, string> = {
  game_start: "game_start.wav",
  game_complete: "game_complete.wav",
  game_over: "game_over.wav",
  game_pause: "game_pause.wav",
  game_resume: "game_resume.wav",
  ui_click: "ui_click.wav",
  ui_hover: "ui_hover.wav",
  player_fire: "cannon_fire_1.wav",
  player_broadside: "cannon_broadside.wav",
  enemy_fire: "cannon_fire_2.wav",
  player_hit: "ship_wood_hit_1.wav",
  ship_collision: "ship_collision.wav",
  explosion: "ship_explosion_1.wav",
  enemy_destroyed: "ship_sinking.wav",
  ambient_ocean: "ocean_ambience_loop.wav",
  ambient_ship: "ship_sailing_loop.wav",
};

export class SoundManager {
  private readonly basePath: string;
  private readonly activeLoops = new Map<GameAudioCue, HTMLAudioElement>();
  private audioContext?: AudioContext;
  private enabled = true;
  private volume = 1;

  constructor(basePath = "/assets/sounds") {
    this.basePath = basePath;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAllLoops();
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const audio of this.activeLoops.values()) {
      audio.volume = this.volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  unlock(): void {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
    }

    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume().catch(() => undefined);
    }
  }

  play(cue: GameAudioCue, volume = 1): void {
    if (!this.enabled) {
      return;
    }

    this.unlock();
    const audio = new Audio(`${this.basePath}/${SOUND_FILES[cue]}`);
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, volume * this.volume));
    void audio.play().catch(() => undefined);
  }

  playRandom(cues: GameAudioCue[], volume = 1): void {
    if (cues.length === 0) {
      return;
    }
    const cue = cues[Math.floor(Math.random() * cues.length)];
    this.play(cue, volume);
  }

  startLoop(cue: GameAudioCue, volume = 0.65): void {
    if (!this.enabled) {
      return;
    }

    this.stopLoop(cue);
    const audio = new Audio(`${this.basePath}/${SOUND_FILES[cue]}`);
    audio.loop = true;
    audio.volume = Math.max(0, Math.min(1, volume * this.volume));
    audio.preload = "auto";
    void audio.play().catch(() => undefined);
    this.activeLoops.set(cue, audio);
  }

  stopLoop(cue: GameAudioCue): void {
    const active = this.activeLoops.get(cue);
    if (!active) {
      return;
    }
    active.pause();
    active.currentTime = 0;
    this.activeLoops.delete(cue);
  }

  private stopAllLoops(): void {
    for (const cue of [...this.activeLoops.keys()]) {
      this.stopLoop(cue);
    }
  }

  dispose(): void {
    this.stopAllLoops();
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch(() => undefined);
    }
  }
}
