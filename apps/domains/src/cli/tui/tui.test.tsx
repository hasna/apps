import React from "react";
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render } from "ink-testing-library";

const tempDir = mkdtempSync(join(tmpdir(), "open-domains-tui-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain, getDomainDetails } from "../../db/domains.js";
import { closeDatabase } from "../../db/database.js";
import { Header } from "./Header.js";
import { DomainTable } from "./DomainTable.js";
import { DomainDetail } from "./DomainDetail.js";
import { App } from "./App.js";
import { stripAnsi } from "./format.js";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

function frameText(lastFrame: () => string | undefined): string {
  return stripAnsi(lastFrame() ?? "");
}

describe("Header", () => {
  test("renders portfolio title and count", () => {
    const { lastFrame } = render(<Header count={3} filter="all" view="list" />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("domains");
    expect(frame).toContain("3 domains");
    expect(frame).toContain("Portfolio");
  });
});

describe("DomainTable", () => {
  test("renders column headers and rows", () => {
    const domains = [
      createDomain({ name: "alpha.com", registrar: "Route53", status: "active" }),
      createDomain({ name: "beta.io", registrar: "Namecheap", status: "expired" }),
    ];

    const { lastFrame } = render(<DomainTable domains={domains} selectedIndex={0} />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("NAME");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("alpha.com");
    expect(frame).toContain("beta.io");
    expect(frame).toContain("❯");
  });

  test("shows empty state", () => {
    const { lastFrame } = render(<DomainTable domains={[]} selectedIndex={0} />);
    expect(frameText(lastFrame)).toContain("No domains match");
  });
});

describe("DomainDetail", () => {
  test("renders domain fields", () => {
    const domain = createDomain({
      name: "detail.test",
      registrar: "GoDaddy",
      status: "active",
      expires_at: "2031-06-01T00:00:00Z",
      notes: "Portfolio note",
    });
    const details = getDomainDetails(domain.id)!;

    const { lastFrame } = render(<DomainDetail details={details} />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("detail.test");
    expect(frame).toContain("GoDaddy");
    expect(frame).toContain("2031-06-01");
    expect(frame).toContain("Portfolio note");
  });
});

describe("App", () => {
  test("loads domains from database in list view", () => {
    createDomain({ name: "interactive-one.com", status: "active" });
    createDomain({ name: "interactive-two.com", status: "active" });

    const { lastFrame } = render(<App />);
    const frame = frameText(lastFrame);
    expect(frame).toContain("interactive-one.com");
    expect(frame).toContain("interactive-two.com");
    expect(frame).toContain("navigate");
  });

  test("moves selection with arrow keys", async () => {
    createDomain({ name: "first.com", status: "active" });
    createDomain({ name: "second.com", status: "active" });

    const { lastFrame, stdin } = render(<App />);
    stdin.write("\x1B[B");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = frameText(lastFrame);
    expect(frame).toContain("first.com");
    expect(frame).toContain("second.com");
    expect(frame).toMatch(/❯|▸/);
  });
});
