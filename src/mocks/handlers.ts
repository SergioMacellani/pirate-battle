import { http, HttpResponse } from "msw";
import { configKey, defaultGameConfig, fixtureRanking, getNetworkScenario, isReadFailure, makeSubmission, paginate, readConfirmedMatches, responseDelay, shouldReturnEmpty, PLAYER_NAME } from "./networkMock";
import type { MatchRecord } from "../game/model/matchTypes";

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function scenarioResponse(url: URL, method: string): Promise<Response | undefined> {
  await wait(responseDelay(url, method));
  const failure = isReadFailure(url.pathname);
  if (failure === 0) return HttpResponse.error();
  if (failure) return HttpResponse.json({ message: "Mock service unavailable" }, { status: failure });
  return undefined;
}

export const handlers = [
  http.get("/api/ranking", async ({ request }) => {
    const url = new URL(request.url);
    const failure = await scenarioResponse(url, "GET");
    if (failure) return failure;
    let config = defaultGameConfig;
    try {
      config = JSON.parse(url.searchParams.get("config") ?? "{}");
    } catch {
      config = defaultGameConfig;
    }
    if (shouldReturnEmpty()) return HttpResponse.json([]);
    const stored = readConfirmedMatches()
      .filter((match) => configKey(match.config) === configKey(config))
      .map((match) => ({ ...match, playerName: match.playerName ?? PLAYER_NAME }));
    const rows = [...fixtureRanking(config, getNetworkScenario() === "paginated"), ...stored];
    return HttpResponse.json(paginate(rows.sort((first, second) => second.score - first.score || second.playedSeconds - first.playedSeconds || first.completedAt.localeCompare(second.completedAt) || first.playerId.localeCompare(second.playerId)), url));
  }),

  http.get("/api/matches", async ({ request }) => {
    const url = new URL(request.url);
    const failure = await scenarioResponse(url, "GET");
    if (failure) return failure;
    const playerId = url.searchParams.get("playerId");
    if (shouldReturnEmpty()) return HttpResponse.json([]);
    return HttpResponse.json(paginate(readConfirmedMatches().filter((match) => match.playerId === playerId), url));
  }),

  http.post("/api/matches", async ({ request }) => {
    const url = new URL(request.url);
    if (getNetworkScenario() === "submit-timeout") {
      const record = await request.json() as MatchRecord;
      const response = makeSubmission(record);
      await wait(responseDelay(url, "POST"));
      return HttpResponse.json(response, { status: response.duplicate ? 200 : 201 });
    }
    const failure = await scenarioResponse(url, "POST");
    if (failure) return failure;
    const record = await request.json() as MatchRecord;
    const response = makeSubmission(record);
    return HttpResponse.json(response, { status: 201 });
  }),
];
