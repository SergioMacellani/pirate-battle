import { defaultGameConfig, type GameConfig } from "../game/config/gameConfig";
import type { MatchRecord, MatchSubmissionResponse, RankingEntry } from "../game/model/matchTypes";

export const MOCK_MATCHES_KEY = "pirate-battle:mock-matches";
export const NETWORK_SCENARIO_KEY = "pirate-battle:network-scenario";
export const NETWORK_SEED_KEY = "pirate-battle:network-seed";
export const PLAYER_NAME = "Novato";

export const networkScenarios = ["success", "empty", "paginated", "slow", "variable-latency", "out-of-order", "timeout", "connection-failure", "ranking-error", "history-error", "submit-timeout", "submit-unavailable"] as const;
export type NetworkScenario = typeof networkScenarios[number];

export const scenarioLabels: Record<NetworkScenario, string> = {
  success: "Success", empty: "Empty lists", paginated: "Multiple pages", slow: "Slow network", "variable-latency": "Variable latency", "out-of-order": "Out of order", timeout: "Request timeout", "connection-failure": "Connection failure", "ranking-error": "Ranking HTTP 503", "history-error": "History HTTP 503", "submit-timeout": "Submit timeout after save", "submit-unavailable": "Submit unavailable",
};

export function configKey(config: GameConfig): string { return JSON.stringify(config); }

export function getNetworkScenario(): NetworkScenario {
  const stored = localStorage.getItem(NETWORK_SCENARIO_KEY);
  return networkScenarios.includes(stored as NetworkScenario) ? stored as NetworkScenario : "success";
}

export function setNetworkScenario(scenario: NetworkScenario): void { localStorage.setItem(NETWORK_SCENARIO_KEY, scenario); }

export function getNetworkSeed(): number {
  const stored = Number(localStorage.getItem(NETWORK_SEED_KEY));
  return Number.isFinite(stored) ? stored : 17;
}

export function readConfirmedMatches(): MatchRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MOCK_MATCHES_KEY) ?? "[]");
    return Array.isArray(value) ? value as MatchRecord[] : [];
  } catch { return []; }
}

export function saveConfirmedMatches(matches: MatchRecord[]): void { localStorage.setItem(MOCK_MATCHES_KEY, JSON.stringify(matches)); }

export function resetNetworkState(): void {
  localStorage.removeItem(MOCK_MATCHES_KEY);
  localStorage.removeItem("pirate-battle:pending-matches");
  setNetworkScenario("success");
  localStorage.setItem(NETWORK_SEED_KEY, "17");
}

export function fixtureRanking(config: GameConfig, extended = false): RankingEntry[] {
  const rows: RankingEntry[] = [
    { matchId: "fixture-nova", playerId: "fixture-nova", playerName: "Captain Nova", completedAt: "2026-09-18T12:00:00.000Z", score: 42, playedSeconds: 102, endReason: "time", config },
    { matchId: "fixture-wolf", playerId: "fixture-wolf", playerName: "Sea Wolf", completedAt: "2026-09-17T12:00:00.000Z", score: 31, playedSeconds: 58, endReason: "player-defeated", config },
    { matchId: "fixture-queen", playerId: "fixture-queen", playerName: "Coral Queen", completedAt: "2026-09-14T12:00:00.000Z", score: 24, playedSeconds: 120, endReason: "time", config },
  ];
  if (!extended) return rows;
  return rows.concat(Array.from({ length: 24 }, (_, index) => ({ matchId: `fixture-page-${index + 1}`, playerId: `fixture-page-${index + 1}`, playerName: `Captain ${index + 1}`, completedAt: `2026-09-${String(13 - (index % 9)).padStart(2, "0")}T12:00:00.000Z`, score: Math.max(1, 22 - index), playedSeconds: 60 + index, endReason: "time" as const, config })));
}

export function paginate<T>(rows: T[], url: URL): T[] {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(20, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20)));
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function stableHash(value: string): number { return [...value].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, getNetworkSeed()); }

export function responseDelay(url: URL, method: string): number {
  const scenario = getNetworkScenario();
  if (scenario === "slow") return 700;
  if (scenario === "timeout" || (scenario === "submit-timeout" && method === "POST")) return 2_200;
  if (scenario === "out-of-order") return url.searchParams.get("page") === "1" ? 650 : 40;
  if (scenario === "variable-latency") return 100 + stableHash(`${method}:${url.pathname}:${url.search}`) % 650;
  return 0;
}

export function isReadFailure(pathname: string): number | undefined {
  const scenario = getNetworkScenario();
  if (scenario === "connection-failure") return 0;
  if (scenario === "ranking-error" && pathname.endsWith("/ranking")) return 503;
  if (scenario === "history-error" && pathname.endsWith("/matches")) return 503;
  if (scenario === "submit-unavailable") return 503;
  return undefined;
}

export function shouldReturnEmpty(): boolean { return getNetworkScenario() === "empty"; }

export function makeSubmission(record: MatchRecord): MatchSubmissionResponse {
  const matches = readConfirmedMatches();
  const existing = matches.find((match) => match.matchId === record.matchId);
  if (existing) return { record: existing, duplicate: true };
  saveConfirmedMatches([...matches, record]);
  return { record, duplicate: false };
}

export { defaultGameConfig };