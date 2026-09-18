import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asMap, parseYaml } from "../../yaml.ts";

const root = resolve(import.meta.dir, "../../../..");

for (const suite of ["control", "gate", "operations"]) {
  test(`Calendar ${suite} admission and refusal controls`, () => {
    const result = Bun.spawnSync(["python3", "-I", "-B", `tooling/deploy/calendar/${suite}_test.py`], { cwd: root, timeout: 30_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toMatch(/Ran \d+ tests[\s\S]*OK/);
  });
}

test("Calendar canonical configuration hash agrees across Python and JavaScript", () => {
  const value = { z: { b: 2, a: "café\n\t\"\\" }, a: [true, null, -9007199254740991], activation_receipt: null };
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]));
    return value;
  }
  const expected = new Bun.CryptoHasher("sha256").update(JSON.stringify(sorted({ z: value.z, a: value.a }))).digest("hex");
  const script = "import importlib.util,pathlib,sys; p=pathlib.Path('tooling/deploy/calendar/control.py'); s=importlib.util.spec_from_file_location('control',p); c=importlib.util.module_from_spec(s); s.loader.exec_module(c); print(c.configuration_digest(c.decode(sys.stdin.buffer.read())))";
  const result = Bun.spawnSync(["python3", "-I", "-B", "-c", script], { cwd: root, stdin: Buffer.from(JSON.stringify(value)) });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(expected);
});

test("Calendar authority follows main CI, approved source, native smoke and scan", () => {
  const caller = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/calendar-promotion.yml"), "utf8")));
  const execute = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/calendar-promotion-execute.yml"), "utf8")));
  expect(Object.keys(asMap(caller.on))).toEqual(["workflow_dispatch"]);
  expect(Object.keys(asMap(execute.on))).toEqual(["workflow_call"]);
  expect(String(asMap(caller.concurrency)["cancel-in-progress"])).toBe("false");
  const jobs = asMap(caller.jobs);
  expect(asMap(jobs.execute).needs).toBe("gate");
  expect(asMap(jobs.execute).uses).toBe("./.github/workflows/calendar-promotion-execute.yml");
  expect(asMap(asMap(jobs.gate).permissions)["id-token"]).toBeUndefined();
  const worker = asMap(asMap(execute.jobs).execute);
  expect(worker.environment).toBe("production");
  expect(worker["runs-on"]).toBe("ubuntu-24.04-arm");
  expect(worker.if).toContain("github.ref == 'refs/heads/main'");
  expect(worker.if).toContain("github.event_name == 'workflow_dispatch'");
  const steps = worker.steps as Array<Record<string, unknown>>;
  const aws = steps.findIndex(s => String(s.uses).startsWith("aws-actions/configure-aws-credentials@"));
  expect(aws).toBeGreaterThan(0);
  for (const command of ["gate.py", "operations_test.py", "container_smoke.py", "operations.py scan"]) {
    const at = steps.findIndex(s => String(s.run).includes(command));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(aws);
  }
  expect(asMap(steps[aws].with)["role-to-assume"]).toBe("${{ vars.CALENDAR_DEPLOY_ROLE_ARN }}");
  expect(steps.filter(s => s.uses).every(s => /@[0-9a-f]{40}$/.test(String(s.uses)))).toBe(true);
  expect(asMap(asMap(asMap(asMap(caller.on).workflow_dispatch).inputs).phase).options).toEqual(["prepare", "reconcile", "promote"]);
});


test("Calendar retains available smoke and scanner diagnostics after prepare refusal", () => {
  const execute = asMap(parseYaml(readFileSync(resolve(root, ".github/workflows/calendar-promotion-execute.yml"), "utf8")));
  const steps = asMap(asMap(execute.jobs).execute).steps as Array<Record<string, unknown>>;
  const evidence = steps.find(s => asMap(s.with).name === "calendar-candidate-evidence")!;
  expect(evidence.if).toBe("${{ always() && inputs.phase == 'prepare' }}");
  expect(asMap(evidence.with)["if-no-files-found"]).toBe("ignore");
  const candidate = steps.find(s => asMap(s.with).name === "calendar-candidate")!;
  expect(candidate.if).toBe("${{ success() && inputs.phase == 'prepare' }}");
  expect(asMap(candidate.with)["if-no-files-found"]).toBe("error");
});
