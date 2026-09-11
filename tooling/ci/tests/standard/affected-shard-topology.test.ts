import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../../../.."), workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"), runner = readFileSync(resolve(root, "tooling/ci/run-affected-shards.ts"), "utf8");
type Workflow = { permissions: unknown; jobs: Record<string, any> };
const step = (job: any, name: string) => job?.steps?.find((row: any) => row.name === name);
function problems(source: Workflow, executable: string): string[] {
  const out: string[] = [], jobs = source.jobs, planner = jobs["affected-plan"], shard = jobs["affected-shard"], aggregate = jobs["build-test"];
  const require = (ok: unknown, label: string) => { if (!ok) out.push(label); };
  require(JSON.stringify(source.permissions) === JSON.stringify({ contents: "read" }), "read-only workflow");
  require(JSON.stringify(Object.keys(jobs)) === JSON.stringify(["gates", "test-suites", "affected-plan", "affected-shard", "build-test", "verify-generated", "publish-guard"]), "explicit complete job topology");
  for (const [name, job] of Object.entries(jobs)) {
    require(job.permissions === undefined && job["continue-on-error"] === undefined, `${name}: no permission or failure override`);
  }
  for (const [name, job] of [["planner", planner], ["shard", shard], ["aggregate", aggregate]] as const) {
    require(job?.["runs-on"] === "ubuntu-latest", `${name}: ephemeral Ubuntu runner`);
    const checkout = job?.steps?.find((s: any) => s.uses?.startsWith("actions/checkout@"));
    require(checkout?.with?.["fetch-depth"] === 0, `${name}: complete history`);
    require(checkout?.with?.ref === (name === "shard" ? "${{ needs.affected-plan.outputs.head }}" : "${{ github.sha }}"), `${name}: exact checkout`);
    require(!job?.steps?.some((s: any) => s.uses?.startsWith("actions/cache@")), `${name}: no cross-run cache restoration`);
  }
  require(shard?.needs === "affected-plan" && shard.strategy?.["max-parallel"] === 4 && shard.strategy?.["fail-fast"] === false, "four independent shards without fail-fast");
  require(shard?.strategy?.matrix === "${{ fromJSON(needs.affected-plan.outputs.matrix) }}", "planner is sole matrix authority");
  require(planner?.env?.NODE_OPTIONS === "--max-old-space-size=14336" && shard?.env?.NODE_OPTIONS === "--max-old-space-size=14336", "preserved memory cap");
  require(step(shard, "Execute serial affected shard")?.run === 'bun tooling/ci/run-affected-shards.ts shard "$RUNNER_TEMP/affected-plan/plan.json" "$AFFECTED_PLAN_SHA256" "$AFFECTED_SHARD" "$RUNNER_TEMP/affected-shard"', "task IDs stay in validated argv");
  require(aggregate?.name === "build + test (affected)" && aggregate.if === "${{ always() }}" && JSON.stringify(aggregate.needs) === JSON.stringify(["affected-plan", "affected-shard"]), "required aggregate runs after every outcome");
  require(step(aggregate, "Verify complete disjoint task execution")?.if === "${{ always() }}", "aggregate validation never skips on failure");
  require(aggregate?.env?.AFFECTED_MATRIX_RESULT === "${{ needs.affected-shard.result }}", "aggregate binds actual matrix result");
  for (const [job, name] of [[planner, "Retain immutable affected plan"], [shard, "Retain shard terminal evidence"], [aggregate, "Retain aggregate acceptance"]] as const) {
    const retain = step(job, name); require(retain?.if === "${{ always() }}" && retain.with?.["if-no-files-found"] === "error", `${name}: missing artifacts refuse`);
    require(retain?.with?.name.includes("github.run_id") && retain.with.name.includes("github.run_attempt"), `${name}: attempt ownership`);
  }
  require(step(shard, "Retain shard terminal evidence")?.with?.name.includes("matrix.shard"), "shard artifact ownership");
  require(step(shard, "Retain Recordings release diagnostics")?.with?.name.includes("matrix.shard"), "Recordings diagnostics remain disjoint");
  const concurrency = [...executable.matchAll(/--concurrency=(\d+)/g)].map(m => m[1]);
  require(concurrency.length === 2 && concurrency.every(n => n === "1"), "serial build/dry/test execution");
  require(!/--(?:only|parallel)(?:[=\s"']|$)/.test(executable) && !executable.includes("--cache=remote"), "dependency expansion and no remote caching");
  return out;
}
test("affected CI preserves serial package semantics on four independent runners and a required aggregate", () => {
  expect(problems(Bun.YAML.parse(workflow) as Workflow, runner)).toEqual([]);
});
test("topology gate refuses skipped/partial matrices, unsafe concurrency, caching and omitted ownership", () => {
  for (const change of [(w: Workflow) => { w.jobs["affected-shard"].strategy["max-parallel"] = 8; }, (w: Workflow) => { w.jobs["affected-shard"].strategy["fail-fast"] = true; }, (w: Workflow) => { w.jobs["build-test"].if = "success()"; }, (w: Workflow) => { w.jobs["affected-shard"]["continue-on-error"] = true; }, (w: Workflow) => { w.jobs["affected-shard"].steps.push({ uses: "actions/cache@v4" }); }, (w: Workflow) => { w.jobs["affected-shard"].steps[0].with.ref = "main"; }, (w: Workflow) => { delete w.jobs["affected-plan"]; }, (w: Workflow) => { step(w.jobs["affected-shard"], "Retain shard terminal evidence").with["if-no-files-found"] = "ignore"; }]) {
    const parsed = Bun.YAML.parse(workflow) as Workflow; change(parsed); expect(problems(parsed, runner).length).toBeGreaterThan(0);
  }
  expect(problems(Bun.YAML.parse(workflow) as Workflow, runner.replaceAll("--concurrency=1", "--concurrency=2"))).toContain("serial build/dry/test execution");
});
