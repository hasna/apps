import { describe, expect, test } from "bun:test";
import {
  compactManifest,
  compactRun,
  DEFAULT_LIST_LIMIT,
  detailLevel,
  formatManifestDetail,
  formatManifestList,
  formatRunDetail,
  formatRunList,
  formatStatus,
  mcpListResponse,
  paginate,
  parsePositiveIntOption,
  truncateText,
} from "./presentation.js";
import type { ActionManifest, ActionRun } from "./types.js";

function manifestFixture(): ActionManifest {
  return {
    id: "tasks.archive",
    name: "Archive tasks",
    version: "1.2.3",
    description: "Archive completed tasks after the retention boundary.",
    inputSchema: { type: "object", required: ["before"] },
    outputSchema: { type: "object" },
    actor: { types: ["human", "agent"] },
    resource: { type: "task" },
    scope: { level: "project", permissions: ["tasks:write"] },
    riskLevel: "high",
    requiredApprovals: [
      { kind: "none" },
      { kind: "manual", count: 2, roles: ["admin"] },
    ],
    idempotency: { supported: true, required: true },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Archive tasks" },
    guardrail: { hook: "tasks.archive.guard" },
    audit: { eventTypes: ["tasks.archive"] },
    evidence: { required: true },
    rollback: { strategy: "manual" },
    executorBindings: [
      { kind: "typescript", ref: "tasks.archive" },
      { kind: "local-shell", command: "tasks" },
    ],
  };
}

function runFixture(): ActionRun {
  const createdAt = "2026-08-17T12:00:00.000Z";
  return {
    id: "run-1",
    actionId: "tasks.archive",
    actionVersion: "1.2.3",
    status: "failed",
    actor: { id: "worker-1", type: "agent" },
    input: { before: "2026-01-01" },
    output: { archived: 0 },
    preview: { summary: "Archive completed tasks" },
    plan: Array.from({ length: 12 }, (_, index) => ({
      id: `step-${index}`,
      kind: "execute",
      title: `Step ${index}`,
      status: "planned" as const,
    })),
    riskLevel: "high",
    requiredApprovals: [{ kind: "manual", count: 2 }],
    approvals: [
      { actor: { id: "approver-1", type: "human" }, decision: "approved" },
    ],
    guardrailResults: [],
    evidence: [],
    dryRun: false,
    confirmationSummary: "Archive completed tasks after the retention boundary.",
    error: "storage unavailable",
    events: Array.from({ length: 7 }, (_, index) => ({
      id: `event-${index}`,
      runId: "run-1",
      actionId: "tasks.archive",
      type: `event.${index}`,
      time: createdAt,
      severity: "info" as const,
      message: `Event ${index}`,
      data: {},
      metadata: {},
    })),
    metadata: {},
    createdAt,
    updatedAt: "2026-08-17T12:01:00.000Z",
  };
}

describe("presentation option boundaries", () => {
  test("accepts only complete safe positive integer strings", () => {
    expect(parsePositiveIntOption("1")).toBe(1);
    expect(parsePositiveIntOption(" 007 ")).toBe(7);
    expect(parsePositiveIntOption(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);

    for (const invalid of [
      "",
      "0",
      "-1",
      "+1",
      "1.5",
      "1e3",
      "12items",
      "Infinity",
      String(Number.MAX_SAFE_INTEGER + 1),
    ]) {
      expect(() => parsePositiveIntOption(invalid)).toThrow(
        `Expected a positive integer, received ${invalid}`,
      );
    }
  });

  test("normalizes list limits without allowing empty pages", () => {
    const items = Array.from({ length: 150 }, (_, index) => index);

    expect(paginate(items).limit).toBe(DEFAULT_LIST_LIMIT);
    expect(paginate(items, { limit: 0 }).limit).toBe(1);
    expect(paginate(items, { limit: 101 }).limit).toBe(100);
    expect(paginate(items, { limit: 3.9 }).limit).toBe(3);
    expect(paginate(items, { limit: Number.NaN, defaultLimit: 7 }).limit).toBe(7);
  });

  test("does not partially parse malformed cursors", () => {
    const items = ["zero", "one", "two", "three"];

    expect(paginate(items, { limit: 2, cursor: "2" })).toMatchObject({
      items: ["two", "three"],
      cursor: 2,
      nextCursor: undefined,
    });
    for (const cursor of ["2items", "1.5", "1e2", "-1", "Infinity", " "]) {
      expect(paginate(items, { limit: 2, cursor })).toMatchObject({
        items: ["zero", "one"],
        cursor: 0,
        nextCursor: "2",
      });
    }
  });

  test("reports stable next cursors at page boundaries", () => {
    expect(paginate([1, 2, 3, 4, 5], { limit: 2, cursor: 2 })).toEqual({
      items: [3, 4],
      total: 5,
      limit: 2,
      cursor: 2,
      nextCursor: "4",
    });
    expect(paginate([1, 2, 3], { limit: 2, cursor: 99 })).toEqual({
      items: [],
      total: 3,
      limit: 2,
      cursor: 99,
      nextCursor: undefined,
    });
  });

  test("falls back to compact detail for unknown values", () => {
    expect(detailLevel("verbose")).toBe("verbose");
    expect(detailLevel("full")).toBe("full");
    expect(detailLevel("VERBOSE")).toBe("compact");
    expect(detailLevel(null)).toBe("compact");
  });

  test("truncates at the exact requested width", () => {
    expect(truncateText("abcdef", 6)).toBe("abcdef");
    expect(truncateText("abcdef", 5)).toBe("ab...");
    expect(truncateText("abcdef", 3)).toBe("abc");
    expect(truncateText("  multi\n line  ", 20)).toBe("multi line");
  });

  test("truncates below the suffix width by raw slicing", () => {
    expect(truncateText("abcdef", 2)).toBe("ab");
    expect(truncateText("abcdef", 1)).toBe("a");
    expect(truncateText("abcdef", 0)).toBe("");
  });

  test("stringifies undefined, null, and objects inline", () => {
    expect(truncateText(undefined)).toBe("");
    expect(truncateText(null)).toBe("null");
    expect(truncateText(42)).toBe("42");
    expect(truncateText({ a: 1 })).toBe('{"a":1}');
    expect(truncateText({ a: "x" }, 5)).toBe("{\"...");
  });
});

describe("presentation summaries", () => {
  test("formats compact and verbose storage status without hiding missing files", () => {
    const status = {
      service: "actions" as const,
      schemaVersion: "1.0" as const,
      dataDir: "/tmp/actions-data",
      storage: { engine: "sqlite" as const, database: { path: "/tmp/actions-data/actions.db", exists: true } },
      env: { primary: "HASNA_ACTIONS_DIR" as const, fallback: "HASNA_ACTIONS_HOME" as const, active: null },
      files: {
        manifests: { path: "/tmp/actions-data/manifests.json", exists: true, records: 2 },
        runs: { path: "/tmp/actions-data/runs.json", exists: false, records: 0 },
        auditEvents: { path: "/tmp/actions-data/audit-events.json", exists: true, records: 3 },
      },
      counts: { manifests: 2, runs: 0, auditEvents: 3 },
    };

    expect(formatStatus(status)).toBe("actions manifests=2 runs=0 auditEvents=3\ndataDir: /tmp/actions-data");
    const verbose = formatStatus(status, { verbose: true });
    expect(verbose).toContain("storage: sqlite database=/tmp/actions-data/actions.db");
    expect(verbose).toContain("runs missing records=0 path=/tmp/actions-data/runs.json");
  });

  test("compacts manifest authority fields and expands them only on request", () => {
    const manifest = manifestFixture();

    expect(compactManifest(manifest)).toEqual({
      id: "tasks.archive",
      version: "1.2.3",
      name: "Archive tasks",
      riskLevel: "high",
      scope: "project",
      approvals: "2 (admin)",
      executors: ["typescript", "local-shell"],
      description: manifest.description,
    });
    expect(compactManifest(manifest, { verbose: true })).toMatchObject({
      actorTypes: ["human", "agent"],
      resource: "task",
      idempotency: "required",
      dryRunDefault: true,
      rollback: "manual",
      guardrail: "tasks.archive.guard",
    });
  });

  test("formats manifest empty, paginated, compact, and verbose views", () => {
    const manifest = manifestFixture();
    expect(formatManifestList({ items: [], total: 0, limit: 20, cursor: 0 })).toBe("no manifests");

    const list = formatManifestList({ items: [manifest], total: 2, limit: 1, cursor: 0, nextCursor: "1" });
    expect(list).toContain("ID");
    expect(list).toContain("tasks.archive");
    expect(list).toContain("showing 1 of 2 manifests");
    expect(list).toContain("next: actions manifests list --cursor 1 --limit 1");

    expect(formatManifestDetail(manifest)).toContain("hint: use --verbose");
    const verbose = formatManifestDetail(manifest, { verbose: true });
    expect(verbose).toContain("guardrail: tasks.archive.guard");
    expect(verbose).toContain('inputSchema: {"type":"object","required":["before"]}');
  });

  test("compacts run state and reports optional output and errors accurately", () => {
    const run = runFixture();
    expect(compactRun(run)).toMatchObject({
      id: "run-1",
      status: "failed",
      approvals: "1/2",
      events: 7,
      hasInput: true,
      hasOutput: true,
      hasError: true,
    });
    expect(compactRun(run, { verbose: true })).toMatchObject({
      actor: "agent:worker-1",
      latestEvent: "event.6",
      error: "storage unavailable",
    });
  });

  test("formats run empty, paginated, compact, and verbose views", () => {
    const run = runFixture();
    expect(formatRunList({ items: [], total: 0, limit: 20, cursor: 0 })).toBe("no runs");

    const list = formatRunList({ items: [run], total: 1, limit: 20, cursor: 0 }, { verbose: true });
    expect(list).toContain("tasks.archive");
    expect(list).toContain("1/2");
    expect(list).toContain("showing 1 of 1 runs");
    expect(list).not.toContain("next: actions runs list");

    expect(formatRunDetail(run)).toContain("hint: use --verbose");
    const verbose = formatRunDetail(run, { verbose: true });
    expect(verbose).toContain("... 2 more steps");
    expect(verbose).toContain("... 2 earlier events");
    expect(verbose).toContain('output: {"archived":0}');
  });

  test("builds machine-readable MCP pagination metadata with an explicit null terminator", () => {
    expect(mcpListResponse(
      "runs",
      { items: ["a"], total: 1, limit: 10, cursor: 0 },
      [{ id: "a" }],
      "inspect run details",
    )).toEqual({
      items: [{ id: "a" }],
      page: { kind: "runs", count: 1, total: 1, limit: 10, cursor: 0, nextCursor: null },
      hint: "inspect run details",
    });
  });

  // agent-authored test-gap addition (SOL consult unavailable: codewith exec with
  // gpt-5.6-sol max reasoning timed out at the 570s window on two distinct accounts
  // before producing a final answer; this spec was written from direct source analysis).
  test("compact run summaries report absent input and output accurately", () => {
    const run = {
      ...runFixture(),
      input: undefined,
      output: undefined,
      error: undefined,
      preview: undefined,
      events: [],
    };
    const compact = compactRun(run);
    expect(compact.hasInput).toBe(false);
    expect(compact.hasOutput).toBe(false);
    expect(compact.hasError).toBe(false);
    expect(compact.events).toBe(0);
    expect(compact.summary).toBe(run.confirmationSummary);
  });
});
