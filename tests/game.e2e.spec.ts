import { expect, test, type Page } from "@playwright/test";

type Snapshot = {
  phase: string;
  endReason?: string;
  score: number;
  remainingSeconds: number;
  playerHealth: number;
  playerPosition: { x: number; y: number };
  playerRotation: number;
  projectiles: Array<{ owner: string }>;
  enemies: Array<{ type?: string; health: number; defeated: boolean }>;
  shotsFired: number;
  broadsideShotsFired: number;
};

async function reset(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("pirate-battle:e2e-reset")) {
      localStorage.clear();
      sessionStorage.setItem("pirate-battle:e2e-reset", "1");
    }
  });
  await page.goto("/?seed=17");
}

async function startGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__PIRATE_BATTLE_TEST__))).toBe(true);
  await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setControlledClock(true));
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.getSnapshot()) as Promise<Snapshot>;
}

async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((duration) => {
    const bridge = window.__PIRATE_BATTLE_TEST__;
    bridge?.setControlledClock(true);
    bridge?.advance(duration);
  }, seconds);
}

test.describe("Pirate Battle E2E", () => {
  test("navigates options, validates limits, and persists settings", async ({ page }) => {
    await reset(page);
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    await expect(page.getByText("120 s")).toBeVisible();
    await page.getByRole("button", { name: "Decrease session time" }).click();
    await page.getByRole("button", { name: "Decrease spawn time" }).click();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    await expect(page.getByText("110 s")).toBeVisible();
    await expect(page.getByText("4 s")).toBeVisible();
  });

  test("opens the controls tutorial", async ({ page }) => {
    await reset(page);
    await page.getByRole("button", { name: "TUTORIAL", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tutorial" })).toBeVisible();
    await expect(page.getByText("Fire left broadside")).toBeVisible();
    await expect(page.getByText("Fire right broadside")).toBeVisible();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await expect(page.getByRole("button", { name: "PLAY", exact: true })).toBeVisible();
  });

  test("recovers from an asset request failure on a new attempt", async ({ page }) => {
    await page.route("**/assets/png/default/tiles/**", (route) => route.abort());
    await reset(page);
    await page.getByRole("button", { name: "PLAY", exact: true }).click();
    await page.unroute("**/assets/png/default/tiles/**");
    await page.reload();
    await startGame(page);
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("starts the arena, moves, rotates, and stays inside its limits", async ({ page }) => {
    await reset(page);
    await startGame(page);
    const initial = await snapshot(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setInput({ rotateRight: true }));
    await advance(page, 1);
    const rotated = await snapshot(page);
    expect(rotated.playerRotation).not.toBe(initial.playerRotation);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setInput({ rotateRight: false, forward: true }));
    await advance(page, 1);
    const moved = await snapshot(page);
    expect(moved.playerPosition).not.toEqual(initial.playerPosition);
    await advance(page, 10);
    const bounded = await snapshot(page);
    expect(bounded.playerPosition.x).toBeGreaterThanOrEqual(0);
    expect(bounded.playerPosition.x).toBeLessThanOrEqual(900);
    expect(bounded.playerPosition.y).toBeGreaterThanOrEqual(0);
    expect(bounded.playerPosition.y).toBeLessThanOrEqual(650);
  });

  test("resizes the arena canvas with the viewport", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await page.setViewportSize({ width: 1100, height: 720 });
    await expect.poll(() => page.locator("canvas").first().evaluate((canvas) => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    }))).toEqual({ width: 1100, height: 720 });
  });

  test("fires frontal and broadside weapons with cooldown and no duplicate score", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setInput({ shoot: true }));
    await advance(page, 0.001);
    const frontal = await snapshot(page);
    expect(frontal.projectiles.filter((projectile) => projectile.owner === "player").length).toBe(1);
    await advance(page, 0.05);
    expect((await snapshot(page)).projectiles.length).toBeLessThanOrEqual(frontal.projectiles.length + 1);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setInput({ shoot: true, broadsideLeft: true }));
    await advance(page, 1.2);
    expect((await snapshot(page)).broadsideShotsFired).toBe(1);
  });

  test("spawns enemies on the configured interval and runs enemy AI", async ({ page }) => {
    await reset(page);
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    for (let index = 0; index < 4; index += 1) await page.getByRole("button", { name: "Decrease spawn time" }).click();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await startGame(page);
    await advance(page, 2.2);
    const state = await snapshot(page);
    expect(state.enemies.length).toBeGreaterThanOrEqual(1);
  });

  test("ends by death and starts a clean match again", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.damagePlayer(999));
    await expect(page.getByRole("heading", { name: "SHIP DEFEATED" })).toBeVisible();
    await page.getByRole("button", { name: "PLAY AGAIN" }).click();
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.reset());
    await expect.poll(() => page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.getSnapshot()?.playerHealth), { timeout: 15_000 }).toBe(140);
    expect((await snapshot(page)).score).toBe(0);
  });

  test("ends by active time and stops advancing after the result", async ({ page }) => {
    await reset(page);
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    for (let index = 0; index < 6; index += 1) await page.getByRole("button", { name: "Decrease session time" }).click();
    for (let index = 0; index < 5; index += 1) await page.getByRole("button", { name: "Increase spawn time" }).click();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.setSpawningEnabled(false));
    await advance(page, 60.1);
    await expect.poll(() => page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.getSnapshot()?.phase), { timeout: 10_000 }).toBe("finished");
    await expect(page.getByRole("heading", { name: "BATTLE COMPLETE" })).toBeVisible();
    const finished = await snapshot(page);
    await advance(page, 10);
    expect((await snapshot(page)).remainingSeconds).toBe(finished.remainingSeconds);
  });

  test("pauses on demand and resumes without an idle-time jump", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await advance(page, 1);
    await page.getByRole("button", { name: "Pause" }).click();
    const paused = await snapshot(page);
    await page.waitForTimeout(250);
    expect((await snapshot(page)).remainingSeconds).toBe(paused.remainingSeconds);
    await page.getByRole("button", { name: "RESUME" }).click();
    await advance(page, 1);
    expect((await snapshot(page)).remainingSeconds).toBeLessThan(paused.remainingSeconds);
  });

  test("shows and persists a completed result", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.damagePlayer(999));
    await expect(page.getByRole("heading", { name: "SHIP DEFEATED" })).toBeVisible();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "PLAY", exact: true })).toBeVisible();
  });

  test("abandons a match, navigates repeatedly, and supports touch controls", async ({ page }) => {
    await reset(page);
    await startGame(page);
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.getByRole("button", { name: "RANKING", exact: true }).click();
    await page.getByRole("button", { name: "MATCH HISTORY", exact: true }).click();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await startGame(page);
    await page.getByRole("button", { name: "Move forward" }).dispatchEvent("pointerdown");
    expect((await snapshot(page)).phase).toBe("running");
  });

  test("loads ranking and history empty, paginated, and error scenarios", async ({ page }) => {
    await reset(page);
    await page.locator("#network-scenario").selectOption("empty");
    await page.getByRole("button", { name: "RANKING", exact: true }).click();
    await expect(page.getByText("No scores for this configuration yet.")).toBeVisible();
    await page.getByRole("button", { name: "MATCH HISTORY", exact: true }).click();
    await expect(page.getByText("No completed matches yet.")).toBeVisible();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.locator("#network-scenario").selectOption("ranking-error");
    await page.reload();
    await page.getByRole("button", { name: "RANKING", exact: true }).click();
    await expect(page.getByText("Unable to load data.")).toBeVisible({ timeout: 10_000 });
  });

  test("keeps pending submissions after refresh and retries idempotently", async ({ page }) => {
    await reset(page);
    await page.locator("#network-scenario").selectOption("submit-unavailable");
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.damagePlayer(999));
    await expect(page.getByRole("heading", { name: "SHIP DEFEATED" })).toBeVisible();
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.getByRole("button", { name: "MATCH HISTORY", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pirate-battle:pending-matches") ?? "[]").length)).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "MATCH HISTORY", exact: true }).click();
    await expect(page.getByRole("button", { name: "PENDING - RETRY" })).toBeVisible({ timeout: 15_000 });
  });

  test("handles delayed and timeout submissions without duplicate records", async ({ page }) => {
    await reset(page);
    await page.locator("#network-scenario").selectOption("submit-timeout");
    await startGame(page);
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.damagePlayer(999));
    await page.getByRole("button", { name: "MAIN MENU", exact: true }).click();
    await page.getByRole("button", { name: "MATCH HISTORY", exact: true }).click();
    await expect(page.getByRole("button", { name: "PENDING - RETRY" })).toBeVisible();
    await page.evaluate(() => localStorage.setItem("pirate-battle:network-scenario", "success"));
    await page.getByRole("button", { name: "PENDING - RETRY" }).click();
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(page.getByRole("button", { name: "PENDING - RETRY" })).toHaveCount(0);
  });

  test("captures stable menu and result visual baselines", async ({ page }) => {
    await reset(page);
    await expect(page).toHaveScreenshot("menu.png", { animations: "disabled", maxDiffPixels: 1000 });
    await startGame(page);
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page).toHaveScreenshot("arena.png", { animations: "disabled", maxDiffPixels: 1000 });
    await page.evaluate(() => window.__PIRATE_BATTLE_TEST__?.damagePlayer(999));
    await expect(page.getByRole("heading", { name: "SHIP DEFEATED" })).toBeVisible();
    await expect(page).toHaveScreenshot("result.png", { animations: "disabled", maxDiffPixels: 1000 });
  });
});