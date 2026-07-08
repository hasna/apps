import React from "react";
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { rmSync } from "node:fs";
import { render } from "ink-testing-library";
import { tuiTestTempDir } from "./tui-test-setup.js";
import { closeDatabase } from "../../db/database.js";
import { createDomain, getDomainDetails, listDomains, deleteDomain } from "../../db/domains.js";
import { Header } from "./Header.js";
import { DomainTable } from "./DomainTable.js";
import { DomainDetail } from "./DomainDetail.js";
import { App } from "./App.js";
import { stripAnsi } from "./format.js";

beforeAll(() => {
  closeDatabase();
});

afterAll(() => {
  closeDatabase();
  rmSync(tuiTestTempDir, { recursive: true, force: true });
});

function frameText(lastFrame: () => string | undefined): string {
  return stripAnsi(lastFrame() ?? "");
}

async function waitForInk(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearDomains(): Promise<void> {
  for (const domain of await listDomains()) {
    await deleteDomain(domain.id);
  }
}

describe("Header", () => {
  test("renders portfolio title and count", async () => {
    const { lastFrame } = render(<Header count={3} filter="all" view="list" />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("domains");
    expect(frame).toContain("3 domains");
    expect(frame).toContain("Portfolio");
  });
});

describe("DomainTable", () => {
  test("renders column headers and rows", async () => {
    const domains = [
      await createDomain({ name: "alpha.com", registrar: "Route53", status: "active" }),
      await createDomain({ name: "beta.io", registrar: "Namecheap", status: "expired" }),
    ];

    const { lastFrame } = render(<DomainTable domains={domains} selectedIndex={0} />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("NAME");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("alpha.com");
    expect(frame).toContain("beta.io");
    expect(frame).toContain("❯");
  });

  test("shows empty state", async () => {
    const { lastFrame } = render(<DomainTable domains={[]} selectedIndex={0} />);
    expect(frameText(lastFrame)).toContain("No domains match");
  });

  test("clamps invalid selected index", async () => {
    const domains = [await createDomain({ name: "solo.com", status: "active" })];
    const { lastFrame } = render(<DomainTable domains={domains} selectedIndex={-1} />);
    expect(frameText(lastFrame)).toContain("❯ solo.com");
  });
});

describe("DomainDetail", () => {
  test("renders domain fields", async () => {
    const domain = await createDomain({
      name: "detail.test",
      registrar: "GoDaddy",
      status: "active",
      expires_at: "2031-06-01T00:00:00Z",
      notes: "Portfolio note",
    });
    const details = (await getDomainDetails(domain.id))!;

    const { lastFrame } = render(<DomainDetail details={details} />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("detail.test");
    expect(frame).toContain("GoDaddy");
    expect(frame).toContain("2031-06-01");
    expect(frame).toContain("Portfolio note");
  });
});

describe("App", () => {
  beforeAll(async () => {
    await clearDomains();
  });

  beforeEach(async () => {
    await clearDomains();
  });

  test("loads domains from database in list view", async () => {
    await createDomain({ name: "interactive-one.com", status: "active" });
    await createDomain({ name: "interactive-two.com", status: "active" });

    const { lastFrame } = render(<App />);
    await waitForInk();
    const frame = frameText(lastFrame);
    expect(frame).toContain("interactive-one.com");
    expect(frame).toContain("interactive-two.com");
    expect(frame).toContain("navigate");
  });

  test("moves selection with arrow keys", async () => {
    await createDomain({ name: "aaa-first.com", status: "active" });
    await createDomain({ name: "bbb-second.com", status: "active" });

    const { lastFrame, stdin } = render(<App />);
    await waitForInk();
    stdin.write("\x1B[B");
    await waitForInk();
    const frame = frameText(lastFrame);
    expect(frame).toContain("❯ bbb-second.com");
  });

  test("initialStatus prop sets the starting filter", async () => {
    await createDomain({ name: "status-active-only.com", status: "active" });
    await createDomain({ name: "status-expired-only.com", status: "expired" });

    const { lastFrame } = render(<App initialStatus="active" />);
    await waitForInk();
    const frame = frameText(lastFrame);
    expect(frame).toContain("Active");
    expect(frame).toContain("status-active-only.com");
    expect(frame).not.toContain("status-expired-only.com");
  });

  test("initialStatus expiring sets expiring filter", async () => {
    await createDomain({
      name: "expiring-soon.com",
      status: "active",
      expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await createDomain({
      name: "expiring-later.com",
      status: "active",
      expires_at: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { lastFrame } = render(<App initialStatus="expiring" />);
    await waitForInk();
    const frame = frameText(lastFrame);
    expect(frame).toContain("Expiring (30d)");
    expect(frame).toContain("expiring-soon.com");
    expect(frame).not.toContain("expiring-later.com");
  });

  test("cycles filters with f key", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForInk();
    expect(frameText(lastFrame)).toContain("All");

    stdin.write("f");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("Active");

    stdin.write("f");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("Expiring (30d)");
  });

  test("recovers selection after empty filter and down arrow", async () => {
    await createDomain({ name: "solo.com", status: "active" });

    const { lastFrame, stdin } = render(<App />);
    await waitForInk();

    stdin.write("f");
    await waitForInk();
    stdin.write("f");
    await waitForInk();
    stdin.write("f");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("Premium");
    expect(frameText(lastFrame)).toContain("No domains match");

    stdin.write("\x1B[B");
    await waitForInk();

    stdin.write("f");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("❯ solo.com");
  });

  test("opens search, finds domains, and selects a result", async () => {
    await createDomain({ name: "findable-search-test.com", status: "active", registrar: "TestRegistrar" });

    const { lastFrame, stdin } = render(<App />);
    await waitForInk();
    stdin.write("/");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("Search domains");

    for (const char of "findable") {
      stdin.write(char);
      await waitForInk(30);
    }
    await waitForInk();
    const searchFrame = frameText(lastFrame);
    expect(searchFrame).toContain("findable-search-test.com");

    stdin.write("\r");
    await waitForInk();
    const detailFrame = frameText(lastFrame);
    expect(detailFrame).toContain("findable-search-test.com");
    expect(detailFrame).toContain("TestRegistrar");
  });

  test("returns from detail view on escape", async () => {
    await createDomain({ name: "escape-detail-test.com", status: "active" });

    const { lastFrame, stdin } = render(<App />);
    await waitForInk();
    stdin.write("/");
    await waitForInk();
    for (const char of "escape-detail") {
      stdin.write(char);
      await waitForInk(30);
    }
    stdin.write("\r");
    await waitForInk();
    expect(frameText(lastFrame)).toContain("escape-detail-test.com");

    stdin.write("\x1B");
    await waitForInk();
    const listFrame = frameText(lastFrame);
    expect(listFrame).toContain("navigate");
    expect(listFrame).toContain("escape-detail-test.com");
  });
});
