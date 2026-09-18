import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asMap, parseYaml } from "../../yaml.ts";

const root = resolve(import.meta.dir, "../../../..");
test("Emails promotion executes bounded source, OCI, task, gate and refusal controls", () => {
  const result = Bun.spawnSync(["python3", "-I", "-B", "tooling/deploy/emails-search/promotion_test.py"], { cwd: root, timeout: 30_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toContain("Ran 41 tests");
});
test("Emails AWS JSON transport verifies sealed descriptors and local CLI parsing", () => {
  const result = Bun.spawnSync(["python3", "-I", "-B", "tooling/deploy/emails-search/aws_transport_test.py"], { cwd: root, timeout: 30_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toContain("Ran 13 tests");
}, 35_000);
test("Emails authority is only behind explicit main CI and production review", () => {
  const caller = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/emails-search-promotion.yml"), "utf8")));
  const execute = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/emails-search-promotion-execute.yml"), "utf8")));
  expect(Object.keys(asMap(caller.on))).toEqual(["workflow_dispatch"]);
  expect(Object.keys(asMap(execute.on))).toEqual(["workflow_call"]);
  const jobs = asMap(caller.jobs);
  expect(asMap(jobs.execute).needs).toBe("gate");
  expect(asMap(asMap(jobs.gate).permissions)["id-token"]).toBeUndefined();
  const worker = asMap(asMap(execute.jobs).execute);
  expect(worker.environment).toBe("production");
  expect(worker.if).toContain("github.ref == 'refs/heads/main'");
  const steps = worker.steps as Array<Record<string, unknown>>;
  const aws = steps.findIndex(s => String(s.uses).startsWith("aws-actions/configure-aws-credentials@"));
  const gate = steps.findIndex(s => String(s.run).includes("gate.py"));
  expect(gate).toBeGreaterThanOrEqual(0);
  expect(gate).toBeLessThan(aws);
  const transport = steps.findIndex(s => String(s.run).includes("aws_transport_test.py"));
  expect(transport).toBeGreaterThanOrEqual(0);
  expect(transport).toBeLessThan(aws);
  expect(steps.filter(s => s.uses).every(s => /@[0-9a-f]{40}$/.test(String(s.uses)))).toBe(true);
  expect(String(steps.find(s => String(s.run).includes("promotion.py"))?.run)).toContain("--prepared-sha256");
  expect(asMap(asMap(caller.on).workflow_dispatch).inputs).toBeDefined();
  expect(readFileSync(resolve(root, ".github/workflows/emails-search-promotion.yml"), "utf8")).toContain("options: [prepare, reconcile, promote, rollback]");
  expect(readFileSync(resolve(root, ".github/workflows/emails-search-promotion-execute.yml"), "utf8")).toContain("emails-search-reconciled");
});
