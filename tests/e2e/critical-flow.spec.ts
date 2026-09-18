import { test, expect } from "@playwright/test";

test.describe("critical DEMO/PAPER flow", () => {
  test("dashboard research, SCAMX reject, paper fill, duplicate blocked, live stays off", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("dashboard-root")).toBeVisible();
    await expect(page.getByTestId("banner-mode")).toContainText("DEMO / PAPER ONLY");
    await expect(page.getByTestId("health-can-broadcast")).toContainText("false");
    await expect(page.getByTestId("health-live-allowed")).toContainText("OFF");
    await expect(page.getByTestId("btn-activate-live")).toHaveCount(0);

    await expect(page.getByTestId("candidate-SCAMX")).toBeVisible();
    await expect(page.getByTestId("proposal-status-SCAMX")).toHaveText("REJECTED");

    const state = await request.get("/api/state");
    expect(state.ok()).toBeTruthy();
    const json = await state.json();
    expect(json.health.liveTradingAllowed).toBe(false);
    expect(json.health.canBroadcast).toBe(false);
    expect(json.candidates.length).toBeGreaterThan(0);

    const badMint = await request.post("/api/state", {
      data: { action: "evaluate", mint: "not-a-mint" },
      headers: { origin: "http://127.0.0.1:4317" },
    });
    expect(badMint.status()).toBe(400);
    const badBody = await badMint.json();
    expect(badBody.code).toBe("INVALID_ACTION");

    const live = await request.post("/api/state", {
      data: { action: "set_mode", mode: "LIVE" },
      headers: { origin: "http://127.0.0.1:4317" },
    });
    expect(live.status()).toBe(400);
    const liveBody = await live.json();
    expect(liveBody.code).toBe("INVALID_ACTION");
    expect(String(liveBody.error)).toMatch(/discriminator|invalid/i);

    const csrf = await request.post("/api/state", {
      data: { action: "reset" },
      headers: { origin: "http://evil.example" },
    });
    expect(csrf.status()).toBe(403);

    await page.getByTestId("candidate-WIF").click();
    await expect(page.getByTestId("btn-paper-execute")).toBeEnabled();
    await page.getByTestId("btn-paper-execute").click();
    await expect(page.getByTestId("action-msg")).toContainText(/Paper fill/i);
    await expect(page.getByTestId("ledger-order").first()).toBeVisible();
    await expect(page.getByTestId("position-WIF")).toBeVisible();
    await expect(page.getByTestId("btn-paper-execute")).toBeDisabled();

    const afterUi = await request.get("/api/state");
    const filled = await afterUi.json();
    const wif = filled.proposals.find((p: { symbol: string }) => p.symbol === "WIF");
    expect(wif?.status).toBe("ACCEPTED_PAPER");
    const dup = await request.post("/api/state", {
      data: { action: "paper_execute", proposalId: wif.id },
      headers: { origin: "http://127.0.0.1:4317" },
    });
    expect(dup.status()).toBe(400);
    const dupBody = await dup.json();
    expect(String(dupBody.error)).toMatch(/already paper-executed/i);

    const health = await request.get("/api/state");
    const after = await health.json();
    expect(after.health.liveTradingAllowed).toBe(false);
    expect(after.health.canBroadcast).toBe(false);

    await page.getByTestId("tab-wallets").click();
    await expect(page.getByTestId("wallet-intel-panel")).toBeVisible();
    await page.getByTestId("tab-lab").click();
    await expect(page.getByTestId("strategy-lab-panel")).toBeVisible();
    await page.getByTestId("btn-run-backtest").click();
    await expect(page.getByTestId("backtest-result")).toBeVisible();
    await page.getByTestId("tab-alerts").click();
    await expect(page.getByTestId("alerts-panel")).toBeVisible();
    await page.getByTestId("btn-create-alert").click();
    await expect(page.getByTestId("action-msg")).toContainText(/alert_create|completed/i);

    const healthApi = await request.get("/api/health");
    expect(healthApi.ok()).toBeTruthy();
    const v1 = await request.get("/api/v1/health");
    expect(v1.ok()).toBeTruthy();
    const body = await v1.json();
    expect(body.data.canBroadcast).toBe(false);
  });
});
