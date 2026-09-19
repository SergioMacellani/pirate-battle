import axios from "axios";
import type { GameConfig } from "../config/gameConfig";
import type { MatchRecord, MatchSubmissionResponse, PendingMatchRecord, RankingEntry } from "../model/matchTypes";

const client = axios.create({
  baseURL: "/api",
  timeout: 1500,
});

const PENDING_KEY = "pirate-battle:pending-matches";
const PLAYER_KEY = "pirate-battle:player-id";
export const PLAYER_NAME = "Novato";
export function getPlayerId(): string {
  const existing = localStorage.getItem(PLAYER_KEY);
  if (existing) return existing;
  const playerId = crypto.randomUUID();
  localStorage.setItem(PLAYER_KEY, playerId);
  return playerId;
}

export function getPendingMatches(): PendingMatchRecord[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingMatchRecord[];
  } catch {
    return [];
  }
}

function savePending(matches: PendingMatchRecord[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(matches));
}

export function rememberPending(record: MatchRecord, error: unknown): PendingMatchRecord {
  const pending: PendingMatchRecord = {
    ...record,
    status: "pending",
    lastError: axios.isAxiosError(error) ? error.message : "Unable to register match",
  };
  const matches = getPendingMatches().filter((item) => item.matchId !== record.matchId);
  savePending([...matches, pending]);
  return pending;
}

export function forgetPending(matchId: string): void {
  savePending(getPendingMatches().filter((item) => item.matchId !== matchId));
}

export function configKey(config: GameConfig): string {
  return JSON.stringify(config);
}

export async function fetchRanking(config: GameConfig): Promise<RankingEntry[]> {
  try {
    const response = await client.get<RankingEntry[]>("/ranking", { params: { config: configKey(config) } });
    return Array.isArray(response.data) ? response.data.filter(isRankingEntry) : [];
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response) return [];
    throw error;
  }
}

export async function fetchHistory(playerId: string): Promise<MatchRecord[]> {
  try {
    const response = await client.get<MatchRecord[]>("/matches", { params: { playerId } });
    return Array.isArray(response.data) ? response.data.filter(isMatchRecord) : [];
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response) return [];
    throw error;
  }
}

export async function submitMatch(record: MatchRecord): Promise<MatchSubmissionResponse> {
  const response = await client.post<MatchSubmissionResponse>("/matches", record, {
    headers: { "Idempotency-Key": record.matchId },
  });
  forgetPending(record.matchId);
  return response.data;
}

export function sortRanking(rows: RankingEntry[], config: GameConfig): RankingEntry[] {
  return rows
    .filter((row) => configKey(row.config) === configKey(config))
    .sort((first, second) => second.score - first.score || second.playedSeconds - first.playedSeconds || first.completedAt.localeCompare(second.completedAt) || first.playerId.localeCompare(second.playerId));
}

function isRankingEntry(value: RankingEntry | null | undefined): value is RankingEntry {
  return Boolean(value && typeof value === "object" && typeof value.matchId === "string" && typeof value.playerId === "string" && typeof value.playerName === "string" && typeof value.score === "number" && typeof value.playedSeconds === "number" && typeof value.completedAt === "string" && value.config);
}

function isMatchRecord(value: MatchRecord | null | undefined): value is MatchRecord {
  return Boolean(value && typeof value === "object" && typeof value.matchId === "string" && typeof value.playerId === "string" && typeof value.score === "number" && typeof value.playedSeconds === "number" && typeof value.completedAt === "string" && value.config);
}

