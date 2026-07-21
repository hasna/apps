import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyBrandReason, scanTrackedFiles } from "./check-branding.mjs";

describe("Loops branding guard", () => {
  test("rejects legacy product-name display variants", () => {
    const displayVariants = [
      "# OpenLoops",
      "All notable changes to OpenLoops are documented here.",
      "Openloops is a scheduler",
      "OPENLOOPS runtime",
      "openloops is a scheduler",
      "Open Loops is a scheduler",
      "open-loops product",
      "Powered by openloops.",
      "Use openloops for scheduling.",
      "The open-loops experience is ready.",
      "Built with openloops.",
      "openloops-powered automation.",
      "Modeled on open-loops' storage ledger.",
      "[open-loops] WARN delayed run",
      "\\nOpenLoops worktree policy:",
    ];

    for (const line of displayVariants) {
      expect(legacyBrandReason(line)).toBeDefined();
    }
  });

  test("allows established compatibility identifiers", () => {
    const compatibilityIdentifiers = [
      'source: "openloops"',
      'const marker = "openloops:triage=go";',
      'const env = "OPENLOOPS_PR_HANDOFF";',
      'const schema = "open-loops.migration/v1";',
      'const role = "open_loops_runtime";',
      'const path = ".openloops/pr-handoff";',
      'const branch = "openloops/repo/task";',
      'name: "open-loops"',
    ];

    for (const line of compatibilityIdentifiers) {
      expect(legacyBrandReason(line)).toBeUndefined();
    }
  });

  test("scans tracked text even when it contains a NUL byte", () => {
    const repo = mkdtempSync(join(tmpdir(), "loops-branding-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "snapshot.txt"), Buffer.from("fixture\u0000OpenLoops worktree policy\n"));
      execFileSync("git", ["add", "snapshot.txt"], { cwd: repo });

      expect(scanTrackedFiles(repo)).toEqual(["snapshot.txt:1:legacy-camel-brand"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
