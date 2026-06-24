import { expect, test, type Page } from "@playwright/test";
import {
  completedDetailFixture,
  detailFixture,
  fakeApiKey,
  installDashboardApiMocks,
  sentinelSecret,
  type DashboardMock,
} from "./fixtures/dashboard";

test.describe("operator dashboard", () => {
  test("renders mocked sessions, stats, tags, and status badges offline", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await installDashboardApiMocks(page);

    await page.goto("/dashboard/");

    await expect(page.getByRole("heading", { name: "Computer Use Dashboard" })).toBeVisible();
    await expect(page.getByTestId("stats-card-Sessions")).toContainText("3");
    await expect(page.getByTestId("stats-card-Completed")).toContainText("1");
    await expect(page.getByTestId("stats-card-Failed")).toContainText("1");
    await expect(page.getByTestId("stats-card-Total Steps")).toContainText("6");
    const browserFleetRow = page.getByTestId("session-row-sess-alpha-browser-fleet");
    await expect(browserFleetRow).toContainText("Inspect visible browser session");
    await expect(browserFleetRow.getByText("browser", { exact: true })).toBeVisible();
    await expect(browserFleetRow.getByText("fleet", { exact: true })).toBeVisible();
    await expect(page.getByTestId("session-row-sess-gamma-approval")).toContainText("waiting_on_approval");
    expect(consoleErrors).toEqual([]);
  });

  test("recovers from 401 after saving an API key and clears auth on request", async ({ page }) => {
    const mock = await installDashboardApiMocks(page, { requireAuth: true });
    await page.goto("/dashboard/");

    await expect(page.getByRole("alert")).toContainText("Authentication required.");
    await page.getByLabel("API key").fill(fakeApiKey());
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("session-row-sess-alpha-browser-fleet")).toBeVisible();
    await expect.poll(() => hasBearerRequest(mock, fakeApiKey())).toBe(true);

    const beforeClear = mock.requests.length;
    await page.getByRole("button", { name: "Clear" }).click();

    await expect.poll(() => mock.requests.slice(beforeClear).some((request) => {
      return request.path.startsWith("/sessions") && request.authorization === undefined;
    })).toBe(true);
  });

  test("renders exact session detail, ordered timeline classes, and redacts typed text", async ({ page }, testInfo) => {
    const mock = await installDashboardApiMocks(page);
    await page.goto("/dashboard/");

    await page.getByTestId("session-row-sess-alpha-browser-fleet").click();

    const detail = page.getByTestId("session-detail");
    await expect(detail).toContainText("anthropic / claude-opus-test");
    await expect(detail).toContainText("Live Timeline");
    await expect(detail).toContainText("200");
    await expect(page.getByTestId("timeline-item-model_decision")).toContainText("Model chose screenshot");
    await expect(page.getByTestId("timeline-item-action")).toContainText(`typed ${sentinelSecret.length} characters`);
    await expect(page.getByTestId("timeline-item-approval")).toContainText("browser.type");
    await expect(page.getByTestId("timeline-item-artifact")).toContainText("/tmp/browser-step-1.png");
    await expect(page.getByText(sentinelSecret)).toHaveCount(0);
    expect(mock.requests.some((request) => request.path === "/sessions/sess-alpha-browser-fleet")).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("desktop-dashboard-detail.png"),
      fullPage: true,
    });
  });

  test("polling updates selected session from running to completed without reload", async ({ page }) => {
    await installDashboardApiMocks(page, {
      detailSequence: [
        detailFixture("sess-alpha-browser-fleet"),
        completedDetailFixture(),
      ],
    });
    await page.goto("/dashboard/");

    await page.getByTestId("session-row-sess-alpha-browser-fleet").click();

    const detail = page.getByTestId("session-detail");
    await expect(detail).toContainText("running");
    await expect(detail).toContainText("completed", { timeout: 5_000 });
    await expect(page.getByTestId("timeline-item-verifier")).toContainText("done");
  });

  test("stats failure keeps the session list visible while surfacing the alert", async ({ page }) => {
    await installDashboardApiMocks(page, { statsFailure: true });

    await page.goto("/dashboard/");

    await expect(page.getByRole("alert")).toContainText("stats offline");
    await expect(page.getByTestId("session-row-sess-alpha-browser-fleet")).toBeVisible();
    await expect(page.getByTestId("stats-bar")).toHaveCount(0);
  });
});

function hasBearerRequest(mock: DashboardMock, token: string): boolean {
  return mock.requests.some((request) => {
    return request.path.startsWith("/sessions") && request.authorization === `Bearer ${token}`;
  });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
