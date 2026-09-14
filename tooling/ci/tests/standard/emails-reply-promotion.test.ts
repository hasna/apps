import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asMap, parseYaml } from "../../yaml.ts";

const root = resolve(import.meta.dir, "../../../..");
const workflow = (name: string) => asMap(parseYaml(readFileSync(resolve(root, `.github/workflows/${name}.yml`), "utf8")));

test("reply promotion validates exact absence, metadata, OCI continuity and prior search receipts", () => {
  const result = Bun.spawnSync(["python3", "-I", "-B", "tooling/deploy/emails-reply/promotion_test.py"], { cwd: root, timeout: 30_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toContain("Ran 16 tests");
});

test("reply promotion reuses the protected trusted execution identity and exclusive search window", () => {
  const caller = workflow("emails-reply-promotion"), search = workflow("emails-search-promotion");
  const execute = workflow("emails-search-promotion-execute");
  expect(Object.keys(asMap(caller.on))).toEqual(["workflow_dispatch"]);
  expect(caller.concurrency).toEqual(search.concurrency);
  const jobs = asMap(caller.jobs), worker = asMap(jobs.execute);
  expect(worker.uses).toBe(asMap(asMap(search.jobs).execute).uses);
  expect(worker.uses).toBe("./.github/workflows/emails-search-promotion-execute.yml");
  expect(worker.needs).toBe("gate");
  expect(asMap(worker.with).overlay).toBe("reply");
  expect(asMap(asMap(jobs.gate).permissions)["id-token"]).toBeUndefined();
  const protectedJob = asMap(asMap(execute.jobs).execute);
  expect(protectedJob.environment).toBe("production");
  const steps = protectedJob.steps as Array<Record<string, unknown>>;
  const aws = steps.findIndex(s => String(s.uses).startsWith("aws-actions/configure-aws-credentials@"));
  const admission = steps.findIndex(s => String(s.run).includes("search|reply"));
  const gate = steps.findIndex(s => String(s.run).includes("gate.py"));
  expect(admission).toBeGreaterThanOrEqual(0);
  expect(admission).toBeLessThan(aws);
  expect(gate).toBeLessThan(aws);
  expect(String(steps[gate]?.run)).toContain("reply) directory=tooling/deploy/emails-reply");
  expect(String(steps[gate]?.run)).toContain("*) exit 2");
  expect(steps.filter(s => s.uses).every(s => /@[0-9a-f]{40}$/.test(String(s.uses)))).toBe(true);
});
