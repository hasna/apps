process.env.TESTERS_DB_PATH = ":memory:";

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { resetDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import { createRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import {
  formatPRComment,
  generateGitHubActionsWorkflow,
  postGitHubComment,
  resolvePullRequestNumber,
} from "./ci.js";
import type { Run, Result } from "../types/index.js";

type RunFixture = { run: Run; results: Result[] };

function buildFixture(): RunFixture {
  resetDatabase();

  const scenario1 = createScenario({
    name: "Homepage loads",
    description: "Verify homepage renders",
    steps: ["Navigate to /", "Check title"],
    tags: ["smoke"],
  });
  const scenario2 = createScenario({
    name: "Login | with pipe in name",
    description: "Ensure pipes don't break markdown",
    steps: ["Navigate to /login"],
    tags: ["auth"],
  });

  const run = createRun({
    url: "https://preview-pr-42.example.com",
    model: "claude-haiku-4-5-20251001",
    headed: false,
    parallel: 1,
  });

  const r1 = updateResult(
    createResult({
      runId: run.id,
      scenarioId: scenario1.id,
      model: "claude-haiku-4-5-20251001",
      stepsTotal: 2,
    }).id,
    {
      status: "passed",
      stepsCompleted: 2,
      durationMs: 1200,
      tokensUsed: 800,
      costCents: 0.1,
    },
  );

  const r2 = updateResult(
    createResult({
      runId: run.id,
      scenarioId: scenario2.id,
      model: "claude-haiku-4-5-20251001",
      stepsTotal: 1,
    }).id,
    {
      status: "failed",
      stepsCompleted: 0,
      durationMs: 4500,
      tokensUsed: 1500,
      costCents: 0.3,
      error: "Selector [data-testid=email] not found",
      reasoning: "Form changed",
    },
  );

  const finalRun: Run = {
    ...run,
    status: "failed",
    passed: 1,
    failed: 1,
    total: 2,
    finishedAt: new Date().toISOString(),
  };

  return { run: finalRun, results: [r1, r2] };
}

describe("generateGitHubActionsWorkflow", () => {
  it("emits a valid GitHub Actions workflow", () => {
    const wf = generateGitHubActionsWorkflow();
    expect(wf).toContain("name: AI QA Tests");
    expect(wf).toContain("on:");
    expect(wf).toContain("pull_request:");
    expect(wf).toContain("runs-on: ubuntu-latest");
    expect(wf).toContain("actions/checkout@v4");
    expect(wf).toContain("oven-sh/setup-bun@v2");
    expect(wf).toContain("bun install -g @hasna/testers");
    expect(wf).toContain("--github-comment");
    expect(wf).toContain("--json");
    expect(wf).toContain("--output results.json");
    expect(wf).toContain("ANTHROPIC_API_KEY");
    expect(wf).toContain("GITHUB_TOKEN");
  });

  it("requests pull-requests: write permission", () => {
    const wf = generateGitHubActionsWorkflow();
    expect(wf).toContain("permissions:");
    expect(wf).toContain("pull-requests: write");
  });

  it("uploads report + results artifact on always()", () => {
    const wf = generateGitHubActionsWorkflow();
    expect(wf).toContain("actions/upload-artifact@v4");
    expect(wf).toContain("if: always()");
    expect(wf).toContain("report.html");
    expect(wf).toContain("results.json");
  });
});

describe("formatPRComment", () => {
  let fixture: RunFixture;

  beforeAll(() => {
    fixture = buildFixture();
  });

  it("includes a pass/fail headline with counts and pass rate", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    expect(body).toContain("## ❌ AI QA Tests — FAILED");
    expect(body).toContain("**1/2 passed** (50%)");
  });

  it("includes the preview URL", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    expect(body).toContain("https://preview-pr-42.example.com");
  });

  it("renders a markdown table with scenario names", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    expect(body).toContain("| Scenario | Status | Duration |");
    expect(body).toContain("Homepage loads");
    // Pipe in scenario name is escaped so it doesn't break the table
    expect(body).toContain("Login \\| with pipe in name");
  });

  it("puts failed scenarios before passed ones", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    const failedIdx = body.indexOf("Login");
    const passedIdx = body.indexOf("Homepage loads");
    expect(failedIdx).toBeGreaterThan(-1);
    expect(passedIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeLessThan(passedIdx);
  });

  it("includes the error message for failures (truncated)", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    expect(body).toContain("Selector [data-testid=email] not found");
  });

  it("includes a dashboard link when provided", () => {
    const body = formatPRComment(fixture.run, fixture.results, "https://dash.example.com");
    expect(body).toContain(`[View full report →](https://dash.example.com/runs/${fixture.run.id})`);
  });

  it("includes total cost when any result has a cost", () => {
    const body = formatPRComment(fixture.run, fixture.results);
    // 0.1c + 0.3c = 0.4c → $0.0040
    expect(body).toContain("$0.0040");
  });

  it("handles 0 scenarios gracefully", () => {
    const emptyRun: Run = {
      ...fixture.run,
      total: 0,
      passed: 0,
      failed: 0,
      status: "passed",
    };
    const body = formatPRComment(emptyRun, []);
    expect(body).toContain("No scenarios ran");
    expect(body).not.toContain("| Scenario | Status | Duration |");
  });

  it("caps rows at 20 and adds a 'more' note", () => {
    // Synthesize 25 fake results (don't persist — the function uses getScenario which may
    // fall through to the id slice when not found)
    const many: Result[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      runId: fixture.run.id,
      scenarioId: `scen${i}`,
      status: "passed",
      reasoning: null,
      error: null,
      stepsCompleted: 1,
      stepsTotal: 1,
      durationMs: 1000,
      model: "claude-haiku-4-5-20251001",
      tokensUsed: 100,
      costCents: 0,
      metadata: null,
      createdAt: new Date().toISOString(),
      personaId: null,
      personaName: null,
      failureAnalysis: null,
    } as unknown as Result));
    const body = formatPRComment(fixture.run, many);
    expect(body).toContain("_...and 5 more_");
  });
});

describe("resolvePullRequestNumber", () => {
  const originalPR = process.env["GITHUB_PR_NUMBER"];
  const originalRef = process.env["GITHUB_REF"];

  beforeEach(() => {
    delete process.env["GITHUB_PR_NUMBER"];
    delete process.env["GITHUB_REF"];
  });

  afterEach(() => {
    if (originalPR !== undefined) process.env["GITHUB_PR_NUMBER"] = originalPR;
    else delete process.env["GITHUB_PR_NUMBER"];
    if (originalRef !== undefined) process.env["GITHUB_REF"] = originalRef;
    else delete process.env["GITHUB_REF"];
  });

  it("prefers the explicit argument", () => {
    process.env["GITHUB_PR_NUMBER"] = "99";
    expect(resolvePullRequestNumber(42)).toBe(42);
  });

  it("falls back to GITHUB_PR_NUMBER", () => {
    process.env["GITHUB_PR_NUMBER"] = "42";
    expect(resolvePullRequestNumber()).toBe(42);
  });

  it("parses GITHUB_REF for pull-request refs", () => {
    process.env["GITHUB_REF"] = "refs/pull/123/merge";
    expect(resolvePullRequestNumber()).toBe(123);
  });

  it("returns null when nothing resolves", () => {
    process.env["GITHUB_REF"] = "refs/heads/main";
    expect(resolvePullRequestNumber()).toBeNull();
  });
});

describe("postGitHubComment", () => {
  const originalToken = process.env["GITHUB_TOKEN"];
  const originalRepo = process.env["GITHUB_REPOSITORY"];
  const originalRef = process.env["GITHUB_REF"];
  const originalPR = process.env["GITHUB_PR_NUMBER"];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_REPOSITORY"];
    delete process.env["GITHUB_REF"];
    delete process.env["GITHUB_PR_NUMBER"];
  });

  afterEach(() => {
    for (const [k, v] of [
      ["GITHUB_TOKEN", originalToken],
      ["GITHUB_REPOSITORY", originalRepo],
      ["GITHUB_REF", originalRef],
      ["GITHUB_PR_NUMBER", originalPR],
    ] as const) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    globalThis.fetch = originalFetch;
  });

  it("returns false when GITHUB_TOKEN missing", async () => {
    const fixture = buildFixture();
    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(false);
  });

  it("returns false when PR number can't be resolved", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_REPOSITORY"] = "owner/repo";
    const fixture = buildFixture();
    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(false);
  });

  it("returns false when GITHUB_REPOSITORY missing", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_PR_NUMBER"] = "7";
    const fixture = buildFixture();
    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(false);
  });

  it("posts to the correct GitHub API endpoint on success", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_REPOSITORY"] = "hasna/open-testers";
    process.env["GITHUB_PR_NUMBER"] = "7";
    const fixture = buildFixture();

    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    }) as typeof fetch;

    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/hasna/open-testers/issues/7/comments");
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.body).toContain("AI QA Tests");
    expect(body.body).toContain("1/2 passed");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ghs_test");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("returns false when fetch throws", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_REPOSITORY"] = "hasna/open-testers";
    process.env["GITHUB_PR_NUMBER"] = "7";
    const fixture = buildFixture();

    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(false);
  });

  it("returns false when GitHub API returns non-2xx", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_REPOSITORY"] = "hasna/open-testers";
    process.env["GITHUB_PR_NUMBER"] = "7";
    const fixture = buildFixture();

    globalThis.fetch = (async () => {
      return new Response("forbidden", { status: 403 });
    }) as typeof fetch;

    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(false);
  });

  it("resolves PR from GITHUB_REF when GITHUB_PR_NUMBER is absent", async () => {
    process.env["GITHUB_TOKEN"] = "ghs_test";
    process.env["GITHUB_REPOSITORY"] = "hasna/open-testers";
    process.env["GITHUB_REF"] = "refs/pull/234/merge";
    const fixture = buildFixture();

    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;

    const ok = await postGitHubComment(fixture.run, fixture.results);
    expect(ok).toBe(true);
    expect(calls[0]).toContain("/issues/234/comments");
  });
});
