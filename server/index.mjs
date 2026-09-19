/* global URL, console, process */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.API_PORT ?? 3001);
const dataPath = join(dirname(fileURLToPath(import.meta.url)), "data", "matches.json");
const pageSize = 20;

async function loadMatches() {
  try {
    return JSON.parse(await readFile(dataPath, "utf8"));
  } catch {
    return [];
  }
}

async function saveMatches(matches) {
  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, JSON.stringify(matches, null, 2));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function configKey(config) {
  return JSON.stringify(config);
}

function fixtureRanking(config) {
  return [
    { matchId: "fixture-nova", playerId: "fixture-nova", playerName: "Captain Nova", completedAt: "2026-09-18T12:00:00.000Z", score: 42, playedSeconds: 102, endReason: "time", config },
    { matchId: "fixture-wolf", playerId: "fixture-wolf", playerName: "Sea Wolf", completedAt: "2026-09-17T12:00:00.000Z", score: 31, playedSeconds: 58, endReason: "player-defeated", config },
    { matchId: "fixture-queen", playerId: "fixture-queen", playerName: "Coral Queen", completedAt: "2026-09-14T12:00:00.000Z", score: 24, playedSeconds: 120, endReason: "time", config },
  ];
}

function sortRanking(rows) {
  return rows.sort((first, second) =>
    second.score - first.score ||
    second.playedSeconds - first.playedSeconds ||
    first.completedAt.localeCompare(second.completedAt) ||
    first.playerId.localeCompare(second.playerId),
  );
}

function paginate(rows, url) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const requestedSize = Number(url.searchParams.get("pageSize") ?? pageSize);
  const size = Math.min(pageSize, Math.max(1, requestedSize));
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

async function handle(request, response) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const matches = await loadMatches();

  if (request.method === "GET" && url.pathname === "/api/ranking") {
    let config;
    try { config = JSON.parse(url.searchParams.get("config") ?? "{}"); } catch { config = {}; }
    const stored = matches
      .filter((match) => configKey(match.config) === configKey(config))
      .map((match) => ({ ...match, playerName: match.playerName ?? "Captain Nova" }));
    sendJson(response, 200, paginate(sortRanking([...fixtureRanking(config), ...stored]), url));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/matches") {
    const playerId = url.searchParams.get("playerId");
    const history = matches.filter((match) => match.playerId === playerId);
    sendJson(response, 200, paginate(history, url));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/matches") {
    let record;
    try { record = await readJson(request); } catch { sendJson(response, 400, { message: "Invalid JSON" }); return; }
    if (!record.matchId || !record.playerId || !record.completedAt || !record.config) {
      sendJson(response, 400, { message: "Invalid match record" });
      return;
    }

    const idempotencyKey = request.headers["idempotency-key"];
    const existing = matches.find((match) => match.matchId === record.matchId || (idempotencyKey && match.matchId === idempotencyKey));
    if (existing) {
      sendJson(response, 200, { record: existing, duplicate: true });
      return;
    }

    const saved = { ...record, playerName: record.playerName ?? "Captain Nova" };
    matches.push(saved);
    await saveMatches(matches);
    sendJson(response, 201, { record: saved, duplicate: false });
    return;
  }

  sendJson(response, 404, { message: "Not found" });
}

createServer((request, response) => {
  void handle(request, response).catch(() => sendJson(response, 500, { message: "Internal server error" }));
}).listen(port, () => {
  console.log(`Pirate Battle API listening on http://localhost:${port}`);
});
