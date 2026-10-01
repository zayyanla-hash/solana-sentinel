import { chromium } from "@playwright/test";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  const screenshotDir = path.resolve(__dirname, "../docs/screenshots");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Start web dev server if port 4317 not listening
  console.log("Checking for dev server on 4317...");
  let serverProcess: any = null;
  const isRunning = await fetch("http://127.0.0.1:4317/api/state")
    .then((r) => r.ok)
    .catch(() => false);

  if (!isRunning) {
    console.log("Starting Next dev server...");
    serverProcess = spawn("pnpm", ["--filter", "@sat/web", "run", "dev"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "pipe",
      env: { ...process.env, PORT: "4317" },
    });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const up = await fetch("http://127.0.0.1:4317/api/state")
        .then((r) => r.ok)
        .catch(() => false);
      if (up) {
        console.log("Dev server ready!");
        break;
      }
    }
  }

  console.log("Launching Chromium...");
  const browser = await chromium.launch();

  // 1. Full Desktop 1440px
  console.log("Capturing 1440px desktop full page...");
  const page1440 = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page1440.goto("http://127.0.0.1:4317");
  await page1440.waitForSelector('[data-testid="dashboard-root"]');
  await page1440.waitForTimeout(1500);
  await page1440.screenshot({ path: path.join(screenshotDir, "dashboard-demo.png"), fullPage: true });
  await page1440.screenshot({ path: path.join(screenshotDir, "terminal-desktop-1440.png"), fullPage: true });
  await page1440.close();

  // 2. Laptop 1280px
  console.log("Capturing 1280px laptop full page...");
  const page1280 = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await page1280.goto("http://127.0.0.1:4317");
  await page1280.waitForSelector('[data-testid="dashboard-root"]');
  await page1280.waitForTimeout(1000);
  await page1280.screenshot({ path: path.join(screenshotDir, "terminal-laptop-1280.png"), fullPage: true });
  await page1280.close();

  // 3. Command Palette Open
  console.log("Capturing command palette...");
  const pagePalette = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await pagePalette.goto("http://127.0.0.1:4317");
  await pagePalette.waitForSelector('[data-testid="dashboard-root"]');
  await pagePalette.keyboard.press("Meta+k");
  await pagePalette.waitForTimeout(500);
  await pagePalette.screenshot({ path: path.join(screenshotDir, "terminal-command-palette.png") });
  await pagePalette.close();

  // 4. Narrow / Tablet 840px
  console.log("Capturing 840px tablet fallback full page...");
  const pageNarrow = await browser.newPage({ viewport: { width: 840, height: 1000 } });
  await pageNarrow.goto("http://127.0.0.1:4317");
  await pageNarrow.waitForSelector('[data-testid="dashboard-root"]');
  await pageNarrow.waitForTimeout(1000);
  await pageNarrow.screenshot({ path: path.join(screenshotDir, "terminal-narrow-840.png"), fullPage: true });
  await pageNarrow.close();

  await browser.close();
  if (serverProcess) serverProcess.kill();
  console.log("All full-page screenshots captured successfully!");
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
