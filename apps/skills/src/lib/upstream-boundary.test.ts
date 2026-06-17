import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("upstream boundary documentation", () => {
  const cloudPackage = "@hasna" + "/cloud";
  const content = readFileSync(
    join(process.cwd(), "docs/architecture/upstream-boundary.md"),
    "utf8",
  );

  test("keeps hasna/skills as the public origin", () => {
    expect(content).toContain("origin");
    expect(content).toContain("hasna/skills");
    expect(content).toContain("canonical open core");
    expect(content).not.toContain(cloudPackage);
  });

  test("separates open-core changes from hosted-wrapper changes", () => {
    expect(content).toContain("Open-Core Changes");
    expect(content).toContain("Hosted-Wrapper Changes");
    expect(content).toContain("compatible API");
    expect(content).toContain("Billing, credits, ledgers");
    expect(content).toContain("Deployment infrastructure");
  });

  test("preserves local-capable upstream behavior", () => {
    expect(content).toContain("Preserve local-capable behavior");
    expect(content).toContain("Keep hosted mode explicit");
    expect(content).toContain("local-safe");
  });

  test("separates native storage from hosted-wrapper databases", () => {
    expect(content).toContain("HASNA_SKILLS_*");
    expect(content).toContain("hosted-wrapper");
    expect(content).toContain("must not pass");
  });
});
