import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["DASHBOARD_PLAYWRIGHT_PORT"] ?? "42173");
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}/dashboard/`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bun run preview --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env["CI"],
  },
  projects: [
    {
      name: "chromium-desktop-offline",
      testMatch: /dashboard\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chromium-mobile-smoke",
      testMatch: /dashboard\.mobile\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
