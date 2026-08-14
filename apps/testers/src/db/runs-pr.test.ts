import { describe, test, expect, beforeEach } from "bun:test";
import { resetDatabase, getDatabase } from "../db/database.js";
import { createRun, getRun, getRunsByPr, getLatestPrRun, listPrRuns, updatePrRunMetadata } from "../db/runs.js";

describe("PR run metadata (OPE9-00279)", () => {
  beforeEach(() => resetDatabase());

  test("createRun stores PR fields", () => {
    const run = createRun({
      url: "https://myapp.vercel.app",
      model: "claude-haiku-4-5-20251001",
      prNumber: 42,
      prTitle: "Add login page",
      prBranch: "feature/login",
      prBaseBranch: "main",
      prCommitSha: "abc123def",
      prUrl: "https://github.com/hasna/open-testers/pull/42",
      ghAppInstallationId: "install-789",
    });

    expect(run.prNumber).toBe(42);
    expect(run.prTitle).toBe("Add login page");
    expect(run.prBranch).toBe("feature/login");
    expect(run.prBaseBranch).toBe("main");
    expect(run.prCommitSha).toBe("abc123def");
    expect(run.prUrl).toBe("https://github.com/hasna/open-testers/pull/42");
    expect(run.ghAppInstallationId).toBe("install-789");
  });

  test("createRun without PR fields has null values", () => {
    const run = createRun({
      url: "https://myapp.com",
      model: "claude-haiku-4-5-20251001",
    });

    expect(run.prNumber).toBeNull();
    expect(run.prTitle).toBeNull();
    expect(run.prBranch).toBeNull();
    expect(run.prCommitSha).toBeNull();
    expect(run.prUrl).toBeNull();
    expect(run.ghAppInstallationId).toBeNull();
  });

  test("getRunsByPr returns only runs for that PR", () => {
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 10 });
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 10 });
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 20 });

    const pr10Runs = getRunsByPr(10);
    expect(pr10Runs).toHaveLength(2);
    expect(pr10Runs.every((r) => r.prNumber === 10)).toBe(true);

    const pr20Runs = getRunsByPr(20);
    expect(pr20Runs).toHaveLength(1);
  });

  test("getLatestPrRun returns most recent run for PR", () => {
    const run1 = createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 5 });
    const run2 = createRun({ url: "https://app.com", model: "claude-sonnet-4-6-20260311", prNumber: 5 });

    const latest = getLatestPrRun(5);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(run2.id);
    expect(latest!.model).toBe("claude-sonnet-4-6-20260311");
  });

  test("getLatestPrRun returns null for unknown PR", () => {
    expect(getLatestPrRun(999)).toBeNull();
  });

  test("listPrRuns returns only runs with pr_number", () => {
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001" });
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 1 });
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 2 });

    const prRuns = listPrRuns();
    expect(prRuns).toHaveLength(2);
    expect(prRuns.every((r) => r.prNumber !== null)).toBe(true);
  });

  test("listPrRuns filters by branch", () => {
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 1, prBranch: "feature/a" });
    createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001", prNumber: 2, prBranch: "feature/b" });

    const filtered = listPrRuns({ branch: "feature/a" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.prBranch).toBe("feature/a");
  });

  test("updatePrRunMetadata adds PR data to existing run", () => {
    const run = createRun({ url: "https://app.com", model: "claude-haiku-4-5-20251001" });
    expect(run.prNumber).toBeNull();

    const updated = updatePrRunMetadata(run.id, {
      prNumber: 77,
      prTitle: "Fix navigation",
      prBranch: "fix/nav",
      prBaseBranch: "develop",
      prCommitSha: "deadbeef",
      prUrl: "https://github.com/hasna/open-testers/pull/77",
    });

    expect(updated.prNumber).toBe(77);
    expect(updated.prTitle).toBe("Fix navigation");
    expect(updated.prBranch).toBe("fix/nav");
    expect(updated.prBaseBranch).toBe("develop");
    expect(updated.prCommitSha).toBe("deadbeef");
    expect(updated.prUrl).toBe("https://github.com/hasna/open-testers/pull/77");
  });

  test("updatePrRunMetadata throws for non-existent run", () => {
    expect(() => updatePrRunMetadata("non-existent", { prNumber: 1 })).toThrow("Run not found");
  });

  test("getRun returns PR fields", () => {
    const created = createRun({
      url: "https://app.com",
      model: "claude-haiku-4-5-20251001",
      prNumber: 3,
      prTitle: "Test PR",
      prCommitSha: "abc",
    });

    const retrieved = getRun(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.prNumber).toBe(3);
    expect(retrieved!.prTitle).toBe("Test PR");
    expect(retrieved!.prCommitSha).toBe("abc");
  });
});
