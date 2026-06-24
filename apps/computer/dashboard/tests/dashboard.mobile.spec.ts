import { expect, test } from "@playwright/test";
import { installDashboardApiMocks } from "./fixtures/dashboard";

test("mobile dashboard smoke renders reachable operator data", async ({ page }, testInfo) => {
  await installDashboardApiMocks(page);

  await page.goto("/dashboard/");

  await expect(page.getByRole("heading", { name: "Computer Use Dashboard" })).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByTestId("session-row-sess-alpha-browser-fleet")).toBeVisible();
  await expect(page.getByText("Auto-refreshing every 3s")).toBeVisible();

  await page.getByTestId("session-row-sess-alpha-browser-fleet").click();
  await expect(page.getByTestId("session-detail")).toContainText("Live Timeline");
  await expect(page.getByTestId("timeline-item-action")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("mobile-dashboard-smoke.png"),
    fullPage: true,
  });
});
