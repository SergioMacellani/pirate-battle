import type { GameConfig } from "../config/gameConfig";

export interface MatchRecord {
  matchId: string;
  playerId: string;
  playerName?: string;
  completedAt: string;
  score: number;
  playedSeconds: number;
  endReason: "time" | "player-defeated";
  config: GameConfig;
}

export interface RankingEntry extends MatchRecord {
  playerName: string;
}

export interface PendingMatchRecord extends MatchRecord {
  status: "pending";
  lastError?: string;
}

export interface MatchSubmissionResponse {
  record: MatchRecord;
  duplicate: boolean;
}