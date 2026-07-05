import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRoutingHealthUpsert, oneLineSummary } from "./routing-health-scan.mjs";

function doctorFixture(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "todos.routing_doctor.v1",
    generated_at: "2026-07-05T12:00:00.000Z",
    ok: false,
    dry_run: true,
    scope: { statuses: ["pending", "in_progress"], project_id: null, tag: null, shard: { index: 0, total: 6 }, include_archived: false, verify_project_root: true, limit: null },
    summary: { inspected: 100, eligible: 40, findings_total: 12, by_category: { wrong_working_dir: 7, null_task_list_id: 5 }, by_repair_class: { safe_auto: 12 }, safe_auto: 12, blockers: 0, unsupported: 0, repaired: 0, repair_failed: 0 },
    findings: [],
    repairs: [],
    ...overrides,
  };
}

describe("routing-health-scan consumer core", () => {
  test("clean scope produces no upsert", () => {
    const clean = doctorFixture({ ok: true, summary: { ...doctorFixture().summary, findings_total: 0, by_category: {}, safe_auto: 0 } });
    expect(buildRoutingHealthUpsert(clean)).toBeNull();
    expect(oneLineSummary(clean)).toContain("clean");
  });

  test("findings produce a deduped, scope-stable upsert spec with preserved metadata", () => {
    const spec = buildRoutingHealthUpsert(doctorFixture())!;
    expect(spec.fingerprint).toBe("routing-health:shard:0-6");
    expect(spec.tags).toEqual(["routing-health", "from-kai"]);
    expect(spec.title).toContain("12 findings");
    expect((spec.metadata as any).routing_health.summary.findings_total).toBe(12);
    expect((spec.metadata as any).routing_health.scope.shard).toEqual({ index: 0, total: 6 });
  });

  test("fingerprint is stable across runs of the same scope (dedupe) and distinct per shard", () => {
    const a = buildRoutingHealthUpsert(doctorFixture())!;
    const b = buildRoutingHealthUpsert(doctorFixture({ generated_at: "2026-07-05T13:00:00.000Z" }))!; // later run, same scope
    expect(a.fingerprint).toBe(b.fingerprint);
    const shard1 = buildRoutingHealthUpsert(doctorFixture({ scope: { ...doctorFixture().scope, shard: { index: 1, total: 6 } } }))!;
    expect(shard1.fingerprint).toBe("routing-health:shard:1-6");
    expect(shard1.fingerprint).not.toBe(a.fingerprint);
  });

  test("project and tag scopes yield distinct fingerprints", () => {
    const proj = buildRoutingHealthUpsert(doctorFixture({ scope: { ...doctorFixture().scope, shard: null, project_id: "p-123" } }))!;
    expect(proj.fingerprint).toBe("routing-health:project:p-123");
    const tag = buildRoutingHealthUpsert(doctorFixture({ scope: { ...doctorFixture().scope, shard: null, project_id: null, tag: "shard-0" } }))!;
    expect(tag.fingerprint).toBe("routing-health:tag:shard-0");
  });

  test("custom source tags are honoured", () => {
    const spec = buildRoutingHealthUpsert(doctorFixture(), { sourceTags: ["routing-health", "from-chief"] })!;
    expect(spec.tags).toEqual(["routing-health", "from-chief"]);
  });
});

// ── spawnSync path at fleet scale ─────────────────────────────────────────────
// Regression guard for the ENOBUFS blocker: the real doctor JSON is ~9 MB
// full-fleet (~789 KB per 1/6 shard) and the default spawnSync maxBuffer is
// 1 MB, so the scan used to die with exit 2 and upsert NOTHING exactly when it
// mattered. These tests drive the REAL script binary-to-binary with a fake
// `--todos-bin` that emits a >1 MB doctor document, covering both spawnSync
// call sites (doctor read + task upsert).

const SCRIPT = join(import.meta.dir, "routing-health-scan.mjs");

let scaleDir: string;
let fakeTodosBin: string;
let upsertCapturePath: string;
let fixtureBytes: number;

function buildLargeDoctorFixture(minBytes: number): string {
  const findings: unknown[] = [];
  const base = doctorFixture({ scope: { statuses: ["pending", "in_progress"], project_id: null, tag: null, shard: null, include_archived: false, verify_project_root: true, limit: null } });
  let json = "";
  let i = 0;
  do {
    for (let n = 0; n < 500; n++, i++) {
      findings.push({
        category: "wrong_working_dir",
        severity: "error",
        repair_class: "safe_auto",
        task_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        task_short_id: null,
        title: `synthetic drifted task ${i} — long title padding to reach realistic per-finding weight in the serialized doctor document`,
        status: "pending",
        project_id: "11111111-2222-4333-8444-555555555555",
        project_name: "open-todos",
        project_path: "/home/hasna/workspace/hasna/opensource/open-todos",
        working_dir: "/home/hasna/workspace/hasnaxyz/agent/agent-chief-of-staff",
        expected_working_dir: "/home/hasna/workspace/hasna/opensource/open-todos",
        task_list_id: null,
        task_list_state: "null",
        route_eligible: true,
        route_class: "eligible",
        route_reasons: [],
        detail: "working_dir (/home/hasna/workspace/hasnaxyz/agent/agent-chief-of-staff) does not match the owning project path; repoint it.",
        suggested_repair: {
          field: "working_dir",
          from: "/home/hasna/workspace/hasnaxyz/agent/agent-chief-of-staff",
          to: "/home/hasna/workspace/hasna/opensource/open-todos",
          command: `todos update 00000000-0000-4000-8000-${String(i).padStart(12, "0")} --working-dir /home/hasna/workspace/hasna/opensource/open-todos`,
        },
      });
    }
    json = JSON.stringify({
      ...(base as Record<string, unknown>),
      summary: { ...(base as any).summary, inspected: findings.length, findings_total: findings.length, safe_auto: findings.length, by_category: { wrong_working_dir: findings.length }, by_repair_class: { safe_auto: findings.length } },
      findings,
    });
  } while (Buffer.byteLength(json, "utf8") < minBytes);
  return json;
}

beforeAll(() => {
  scaleDir = join(tmpdir(), `routing-health-scan-scale-${crypto.randomUUID()}`);
  mkdirSync(scaleDir, { recursive: true });
  const fixturePath = join(scaleDir, "doctor-large.json");
  upsertCapturePath = join(scaleDir, "upsert-argv.json");
  const json = buildLargeDoctorFixture(2 * 1024 * 1024);
  fixtureBytes = Buffer.byteLength(json, "utf8");
  writeFileSync(fixturePath, json);
  // Fake todos bin: `doctor routing --json` streams the >1MB fixture and exits 1
  // (findings present); `task upsert` records its argv and succeeds.
  fakeTodosBin = join(scaleDir, "fake-todos");
  writeFileSync(
    fakeTodosBin,
    `#!/bin/sh
if [ "$1" = "doctor" ] && [ "$2" = "routing" ]; then
  cat "${fixturePath}"
  exit 1
fi
if [ "$1" = "task" ] && [ "$2" = "upsert" ]; then
  printf '%s\\n' "$*" > "${upsertCapturePath}"
  printf '{"created":true,"task":{"id":"fake"}}\\n'
  exit 0
fi
echo "fake-todos: unexpected argv: $*" >&2
exit 9
`,
  );
  chmodSync(fakeTodosBin, 0o755);
});

afterAll(() => {
  rmSync(scaleDir, { recursive: true, force: true });
});

describe("routing-health-scan spawnSync path at scale (>1MB doctor JSON)", () => {
  test("fixture actually exceeds the 1MB default maxBuffer that caused ENOBUFS", () => {
    expect(fixtureBytes).toBeGreaterThan(1024 * 1024);
  });

  test("dry-run ingests a >1MB doctor document and exits 1 (doctor call site)", () => {
    const run = spawnSync("bun", [SCRIPT, "--todos-bin", fakeTodosBin, "--dry-run"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    expect(run.stderr).not.toContain("doctor invocation failed");
    expect(run.stderr).not.toContain("could not parse doctor JSON");
    expect(run.stdout).toContain("would upsert fingerprint=routing-health:all");
    expect(run.status).toBe(1);
  });

  test("real run ingests >1MB, upserts through the second spawnSync, and exits 1", () => {
    rmSync(upsertCapturePath, { force: true });
    const run = spawnSync("bun", [SCRIPT, "--todos-bin", fakeTodosBin], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    expect(run.stderr).not.toContain("failed");
    expect(run.stdout).toContain("upserted routing-health:all");
    expect(run.status).toBe(1);
    const captured = readFileSync(upsertCapturePath, "utf8");
    expect(captured).toContain("--fingerprint routing-health:all");
    expect(captured).toContain("routing-health,from-kai");
  });
});
