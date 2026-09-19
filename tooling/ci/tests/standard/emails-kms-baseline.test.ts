import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asMap, parseYaml } from "../../yaml.ts";

const root = resolve(import.meta.dir, "../../../..");
test("Emails paired KMS baseline refuses drift, replay and ambiguous writes", () => {
  const result = Bun.spawnSync(["python3", "-I", "-B", "tooling/deploy/emails-kms-baseline/test_baseline.py"], { cwd: root, timeout: 30_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toContain("OK");
});
test("Emails KMS caller uses the existing protected executor and pinned actions", () => {
  const caller = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/emails-kms-baseline.yml"), "utf8")));
  const reusable = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/emails-search-promotion-execute.yml"), "utf8")));
  expect(Object.keys(asMap(caller.on))).toEqual(["workflow_dispatch"]);
  expect(asMap(caller.concurrency)).toEqual({ group: "emails-search-production", "cancel-in-progress": "false" });
  expect(asMap(asMap(caller.jobs).execute).uses).toBe("./.github/workflows/emails-search-promotion-execute.yml");
  const job = asMap(asMap(reusable.jobs)["kms-baseline"]);
  expect(job.environment).toBe("production");
  const steps = job.steps as Array<Record<string, unknown>>;
  expect(steps.filter(s => s.uses).every(s => /@[0-9a-f]{40}$/.test(String(s.uses)))).toBe(true);
  const upload = steps.findIndex(s => s.name === "Persist paired KMS mutation intent");
  const assume = steps.findIndex(s => String(s.uses).startsWith("aws-actions/configure-aws-credentials@"));
  expect(upload).toBeGreaterThan(0);
  expect(upload).toBeLessThan(assume);
});
