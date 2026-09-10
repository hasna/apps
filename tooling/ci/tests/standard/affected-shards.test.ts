import { describe, expect, test } from "bun:test";
import { aggregate, canonical, dependencyClosure, hash, makePlan, parseDryRun, partition, sameGraph, TOOLCHAIN, validateManifest, validatePlan, verifySummary,
  type Context, type Phase, type Plan, type Receipt, type Task } from "../../affected-shards";

const context: Context = { repository: "hasna/apps", runId: "123", runAttempt: "1", head: "1".repeat(40), tree: "2".repeat(40), base: "3".repeat(40), lockSha256: "4".repeat(64), toolchain: TOOLCHAIN };
const timing = { defaultSeconds: 300, estimatesSeconds: { "@hasna/todos#test": 753, "@hasna/emails#test": 402 } };
const raw = (name: string, task: string, dependencies: string[] = [], command = task === "build" ? "bun run build:real" : "bun test --timeout 30000") => ({ taskId: `@hasna/${name}#${task}`, package: `@hasna/${name}`, task, directory: `apps/${name}`, dependencies, command });
const dry = (tasks: unknown[]) => ({ turboVersion: "2.5.4", envMode: "strict", scm: { sha: context.head }, tasks });
function fixture(): Plan {
  const builds = [raw("contracts", "build"), raw("todos", "build", ["@hasna/contracts#build"]), raw("emails", "build"), raw("notes", "build", [], "<NONEXISTENT>"), { ...raw("notes-server", "build", [], "<NONEXISTENT>"), taskId: "notes-server#build", package: "notes-server", directory: "apps/notes/server" }];
  const tests = [raw("todos", "test", ["@hasna/todos#build"]), raw("emails", "test", ["@hasna/emails#build"], "bun run test:hermetic"), raw("notes", "test", ["@hasna/notes#build"]), { ...raw("notes-server", "test", ["notes-server#build"]), taskId: "notes-server#test", package: "notes-server", directory: "apps/notes/server" }];
  return makePlan(context, parseDryRun(dry(builds), context.head), parseDryRun(dry([...builds, ...tests]), context.head), timing);
}
function summary(graph: Task[]) {
  return { ...dry([]), execution: { exitCode: 0 }, tasks: graph.filter(t => t.command !== null).map(t => ({ ...t, cache: { status: "MISS" }, execution: { exitCode: 0, startTime: 1, endTime: 2 } })) };
}
function phase(graph: Task[]): Phase {
  const empty = !graph.some(t => t.command !== null);
  return { status: empty ? "noop" : "passed", graph, executed: verifySummary(summary(graph), graph, context.head, new Set()), summarySha256: empty ? null : hash(canonical(summary(graph))) };
}
function receipts(plan: Plan): Receipt[] {
  return plan.shards.map(shard => ({ schemaVersion: 1, context: plan.context, planSha256: hash(canonical(plan)), shard: shard.id, status: "passed", assignedTests: shard.tests,
    build: phase(plan.buildGraph), test: phase(dependencyClosure(plan.testGraph, shard.tests)) }));
}
describe("affected task plan", () => {
  test("partitions exact executable tasks; retains nested workspace and nonexecuting build nodes", () => {
    const plan = fixture(); expect(validatePlan(plan)).toEqual(plan);
    expect(plan.shards).toHaveLength(4); expect(plan.shards.flatMap(s => s.tests).sort()).toEqual(plan.testGraph.filter(t => t.task === "test").map(t => t.taskId));
    expect(plan.buildGraph.filter(t => t.command === null).map(t => t.taskId)).toEqual(["@hasna/notes#build", "notes-server#build"]);
    expect(partition([...plan.testGraph].reverse(), timing)).toEqual(plan.shards);
  });
  test("new and renamed test tasks get the conservative default, never timing-based omission", () => {
    const graph = parseDryRun(dry([raw("new-member", "test"), raw("renamed-member", "test")]), context.head);
    const bins = partition(graph, timing); expect(bins.flatMap(s => s.tests).sort()).toEqual(graph.map(t => t.taskId)); expect(bins.reduce((n, s) => n + s.estimatedSeconds, 0)).toBe(600);
  });
  test("test dependency components stay on one runner and dependency expansion preserves exact tasks", () => {
    const graph = parseDryRun(dry([raw("base", "test"), raw("dependent", "test", ["@hasna/base#test"]), raw("other", "test")]), context.head);
    const bins = partition(graph, timing); expect(bins.find(s => s.tests.includes("@hasna/dependent#test"))!.tests).toEqual(["@hasna/base#test", "@hasna/dependent#test"]);
    expect(() => sameGraph(dependencyClosure(graph, ["@hasna/dependent#test"]), dependencyClosure(graph, ["@hasna/other#test"]))).toThrow();
  });
  test("duplicate, missing, unknown, cyclic and argument-injecting tasks fail before execution", () => {
    for (const rows of [[raw("a", "test"), raw("a", "test")], [raw("a", "test", ["@hasna/missing#build"])], [raw("a", "test", ["@hasna/a#test"])], [{ ...raw("a", "test"), taskId: "--filter=*#test" }], [{ ...raw("a", "test"), directory: "apps/../escape" }], [raw("a", "test", [], "")]])
      expect(() => parseDryRun(dry(rows), context.head)).toThrow();
    expect(() => parseDryRun({ ...dry([]), envMode: "loose" }, context.head)).toThrow();
    expect(() => parseDryRun(dry([]), "5".repeat(40))).toThrow();
  });
  test("manifests prove command identity and honest no-command build placeholders", () => {
    const graph = fixture().buildGraph, none = graph.find(t => t.command === null)!;
    expect(() => validateManifest(none, { name: none.package })).not.toThrow();
    expect(() => validateManifest(none, { name: none.package, scripts: { build: "NONEXISTENT" } })).toThrow();
    for (const value of [null, {}, { name: "@hasna/other" }, { name: graph[0]!.package, scripts: { build: "different" } }]) expect(() => validateManifest(graph[0]!, value)).toThrow();
  });
  test("tampered assignment, command hash, base identity and duration data refuse", () => {
    const plan = fixture();
    for (const mutate of [(p: Plan) => p.shards.pop(), (p: Plan) => p.shards[0]!.tests.push("@hasna/other#test"), (p: Plan) => { p.buildGraph[0]!.commandSha256 = "x"; }, (p: Plan) => { p.context.base = "origin/main"; }, (p: Plan) => { p.timing.defaultSeconds = 0; }]) {
      const changed = structuredClone(plan); mutate(changed); expect(() => validatePlan(changed)).toThrow();
    }
  });
});
describe("terminal affected acceptance", () => {
  test("exact disjoint union accepts all four terminal receipts", () => {
    const plan = fixture(); const result = aggregate(plan, hash(canonical(plan)), receipts(plan), "success"); expect(result.shards).toBe(4); expect(result.tests).toHaveLength(4);
  });
  test("empty graph still requires four successful honest no-op receipts", () => {
    const plan = makePlan(context, [], [], timing), rows = receipts(plan), sha = hash(canonical(plan));
    expect(aggregate(plan, sha, rows, "success")).toEqual({ tests: [], shards: 4 });
    expect(() => aggregate(plan, sha, [], "success")).toThrow();
    rows[0]!.test!.status = "passed"; expect(() => aggregate(plan, sha, rows, "success")).toThrow();
  });
  test("matrix failure, cancellation and skipped jobs always refuse", () => {
    const plan = fixture(); for (const result of ["failure", "cancelled", "skipped", ""]) expect(() => aggregate(plan, hash(canonical(plan)), receipts(plan), result)).toThrow();
  });
  test("missing, duplicate, failed, wrong-plan and foreign-checkout receipts refuse", () => {
    const plan = fixture(); const sha = hash(canonical(plan));
    for (const change of [(r: Receipt[]) => r.pop(), (r: Receipt[]) => { r[1] = r[0]!; }, (r: Receipt[]) => { r[0]!.status = "failed"; }, (r: Receipt[]) => { r[0]!.planSha256 = "f".repeat(64); }, (r: Receipt[]) => { r[0]!.context.head = "e".repeat(40); }, (r: Receipt[]) => { r[0]!.context.base = "e".repeat(40); }, (r: Receipt[]) => { r[0]!.context.runAttempt = "2"; }, (r: Receipt[]) => { delete r[0]!.test; }]) {
      const rows = structuredClone(receipts(plan)); change(rows); expect(() => aggregate(plan, sha, rows, "success")).toThrow();
    }
  });
  test("missing/extra/wrong commands, failed exits and cached tests are not execution evidence", () => {
    const graph = dependencyClosure(fixture().testGraph, ["@hasna/todos#test"]);
    for (const change of [(r: any) => r.tasks.pop(), (r: any) => r.tasks.push(r.tasks[0]), (r: any) => { r.tasks[0].command = "different"; }, (r: any) => { r.tasks[0].execution.exitCode = 1; }, (r: any) => { r.tasks.find((t: Task) => t.task === "test").cache = { status: "HIT", source: "LOCAL" }; }]) {
      const result = summary(graph); change(result); expect(() => verifySummary(result, graph, context.head, new Set(graph.map(t => t.taskId)))).toThrow();
    }
    const result = summary(graph); result.tasks[0]!.cache = { status: "HIT", source: "LOCAL" } as any;
    expect(() => verifySummary(result, graph, context.head, new Set())).toThrow();
    expect(() => verifySummary(result, graph, context.head, new Set([result.tasks[0]!.taskId]))).not.toThrow();
  });
});
