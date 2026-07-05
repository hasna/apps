import { describe, expect, test } from "bun:test";
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
