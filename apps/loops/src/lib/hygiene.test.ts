import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { buildDuplicateOverlapReport, buildNameHygieneReport, buildScriptInventoryReport } from "./hygiene.js";

describe("hygiene", () => {
  test("name hygiene canonicalizes provider-prefixed machine loop names", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "Claude: Check Disk",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store);
      expect(report.applied).toBe(false);
      expect(report.checked).toBe(1);
      expect(report.changed).toBe(1);
      expect(report.changes[0]?.scope).toBe("machine");
      expect(report.changes[0]?.newName).toBe("machine-check-disk");
      expect(report.ok).toBe(false);
      // Dry run must not rename anything.
      expect(store.findLoopByName("Claude: Check Disk")).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("name hygiene scopes repo loops by cwd and strips cadence suffixes", () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-hygiene-repo-"));
    const repo = join(root, "acme-app");
    mkdirSync(repo, { recursive: true });
    try {
      store.createLoop({
        name: "codewith:acme-app:lint:hourly",
        schedule: { type: "interval", everyMs: 3_600_000 },
        target: { type: "command", command: "true", cwd: repo },
      });
      const report = buildNameHygieneReport(store, { apply: true });
      expect(report.applied).toBe(true);
      expect(report.changed).toBe(1);
      expect(report.changes[0]?.scope).toBe("repo");
      expect(report.changes[0]?.scopeSlug).toBe("acme-app");
      expect(report.changes[0]?.newName).toBe("repo-acme-app-lint");
      expect(store.findLoopByName("repo-acme-app-lint")).toBeDefined();
      expect(store.findLoopByName("codewith:acme-app:lint:hourly")).toBeUndefined();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("name hygiene scopes managed worktree cwd by repository slug", () => {
    const store = new Store(":memory:");
    const home = process.env.HOME || homedir();
    const worktree = join(
      home,
      ".hasna",
      "loops",
      "worktrees",
      "open-loops",
      "a813060b-7895-4fa5-9efa-645f89fa7487-67e7783c",
    );
    try {
      store.createLoop({
        name: "codewith:open-loops:lint:hourly",
        schedule: { type: "interval", everyMs: 3_600_000 },
        target: { type: "command", command: "true", cwd: worktree },
      });
      store.createLoop({
        name: "codewith:open-loops:typecheck:daily",
        schedule: { type: "interval", everyMs: 86_400_000 },
        target: { type: "command", command: "true", cwd: join(worktree, "src", "lib") },
      });
      const report = buildNameHygieneReport(store);
      const names = report.changes.map((change) => change.newName).sort();
      expect(report.checked).toBe(2);
      expect(report.changed).toBe(2);
      expect(report.changes.every((change) => change.scope === "repo")).toBe(true);
      expect(report.changes.every((change) => change.scopeSlug === "open-loops")).toBe(true);
      expect(names).toEqual(["repo-open-loops-lint", "repo-open-loops-typecheck"]);
      expect(names).not.toContain("repo-a813060b-7895-4fa5-9efa-645f89fa7487-67e7783c-lint");
      expect(names).not.toContain("repo-lib-typecheck");
    } finally {
      store.close();
    }
  });

  test("name hygiene keeps non-worktree loops data cwd machine scoped", () => {
    const store = new Store(":memory:");
    const home = process.env.HOME || homedir();
    try {
      store.createLoop({
        name: "codewith:loops:data",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true", cwd: join(home, ".hasna", "loops", "reports", "health-scan") },
      });
      const report = buildNameHygieneReport(store);
      expect(report.checked).toBe(1);
      expect(report.changed).toBe(1);
      expect(report.changes[0]?.scope).toBe("machine");
      expect(report.changes[0]?.scopeSlug).toBe("machine");
      expect(report.changes[0]?.newName).toBe("machine-loops-data");
    } finally {
      store.close();
    }
  });

  test("name hygiene keeps already-canonical names and reports ok", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "machine-check-disk",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store);
      expect(report.ok).toBe(true);
      expect(report.changed).toBe(0);
      expect(report.changes[0]?.changed).toBe(false);
    } finally {
      store.close();
    }
  });

  test("name hygiene disambiguates colliding canonical names with id suffixes", () => {
    const store = new Store(":memory:");
    try {
      const first = store.createLoop({
        name: "Claude: lint",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const second = store.createLoop({
        name: "codewith: lint",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildNameHygieneReport(store, { apply: true });
      expect(report.changed).toBe(2);
      const names = report.changes.map((change) => change.newName).sort();
      expect(names).toContain("machine-lint");
      const suffixed = names.find((name) => name !== "machine-lint")!;
      expect(suffixed).toStartWith("machine-lint-");
      expect([first.id.slice(0, 8), second.id.slice(0, 8)]).toContain(suffixed.slice("machine-lint-".length));
      expect(new Set(names).size).toBe(2);
    } finally {
      store.close();
    }
  });

  test("duplicate overlap groups loops sharing base name, cwd, and schedule", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "job-a",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-a-15m",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-b",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildDuplicateOverlapReport(store);
      expect(report.ok).toBe(false);
      expect(report.checked).toBe(3);
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]?.baseName).toBe("job-a");
      expect(report.groups[0]?.schedule).toBe("interval:60000");
      expect(report.groups[0]?.loops.map((loop) => loop.name).sort()).toEqual(["job-a", "job-a-15m"]);
    } finally {
      store.close();
    }
  });

  test("duplicate overlap treats different schedules as distinct", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "job-c",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.createLoop({
        name: "job-c-15m",
        schedule: { type: "interval", everyMs: 120_000 },
        target: { type: "command", command: "true" },
      });
      const report = buildDuplicateOverlapReport(store);
      expect(report.ok).toBe(true);
      expect(report.groups).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("script inventory flags loops that call scripts from the loops data dir", () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-hygiene-scripts-"));
    const scriptsDir = join(root, "scripts");
    try {
      store.createLoop({
        name: "script-backed",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: `bash ${scriptsDir}/check.sh`, shell: true },
      });
      store.createLoop({
        name: "home-script-backed",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "bash $HOME/.hasna/loops/scripts/audit.sh", shell: true },
      });
      store.createLoop({
        name: "inline-clean",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const report = buildScriptInventoryReport(store, { scriptsDir });
      expect(report.ok).toBe(false);
      expect(report.checked).toBe(3);
      expect(report.scriptBacked).toBe(2);
      expect(report.loops.map((loop) => loop.name).sort()).toEqual(["home-script-backed", "script-backed"]);
      const flagged = report.loops.find((loop) => loop.name === "script-backed")!;
      expect(flagged.scriptMatches.some((match) => match.startsWith(scriptsDir))).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("script inventory reports ok when no loops reference managed scripts", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "inline-only",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const report = buildScriptInventoryReport(store);
      expect(report.ok).toBe(true);
      expect(report.scriptBacked).toBe(0);
      expect(report.loops).toEqual([]);
    } finally {
      store.close();
    }
  });
});
