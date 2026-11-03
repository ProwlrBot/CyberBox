import { chromium } from "../../platform/frontend/node_modules/playwright/index.mjs";
import { existsSync } from "node:fs";

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error("usage: dashboard_smoke.mjs <base-url>");

const systemBrowser = [
  process.env.CYBERBOX_CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(systemBrowser ? { executablePath: systemBrowser } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  for (const panel of ["code", "browser", "terminal", "jupyter", "csbx"]) {
    await page.locator(`button[data-panel="${panel}"]`).waitFor({ state: "visible" });
  }

  await page.locator('button[data-panel="csbx"]').click();
  const pluginFrame = page.locator('iframe[src^="/csbx/"]');
  await pluginFrame.waitFor({ state: "visible", timeout: 15_000 });

  const pluginPage = page.frameLocator('iframe[src^="/csbx/"]');
  await pluginPage.getByRole("button", { name: /System health/i }).click();
  await pluginPage.locator('[data-component-id="browser"]').waitFor();
  await pluginPage.locator('[data-component-id="terminal"]').waitFor();
  await pluginPage.locator('[data-component-id="jupyter"]').waitFor();
  const health = await pluginPage.locator("#health").innerText();
  if (health !== "Ready") throw new Error(`dashboard health is ${health}`);
  if (consoleErrors.length) throw new Error(`browser console errors: ${consoleErrors.join(" | ")}`);
  console.log("browser smoke passed: shell panels, Plugin Center iframe, component health");
} finally {
  await browser.close();
}
