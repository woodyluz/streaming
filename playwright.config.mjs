import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    serviceWorkers: "block",
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    launchOptions: process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {},
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/e2e/mock-server.mjs",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: !process.env.CI
  }
});
