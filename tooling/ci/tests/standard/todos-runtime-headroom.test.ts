import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseYaml, asMap, asArray, asText } from "../../yaml.ts";

const root = resolve(import.meta.dir, "../../../..");
const workflow = asMap(parseYaml(readFileSync(join(root, ".github/workflows/deploy-todos.yml"), "utf8")));
const steps = asArray(asMap(asMap(workflow.jobs).deploy).steps).map(asMap);
const deploy = steps.find(step => asText(step.name) === "Register digest-pinned task definition and update service")!;
const previous = "arn:aws:ecs:us-east-1:000000000000:task-definition/todos-fixture:94";
const image = "registry.example/todos@sha256:" + "a".repeat(64);
const current = {
  taskDefinitionArn: previous, family: "todos-fixture", revision: 94, status: "ACTIVE",
  cpu: "1024", memory: "4096", taskRoleArn: "fixture-task-role", executionRoleArn: "fixture-execution-role",
  runtimePlatform: { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" },
  containerDefinitions: [
    { name: "web", image: "registry.example/old", environment: [{ name: "KEEP", value: "unchanged" }, { name: "TODOS_RATE_LIMIT_MAX", value: "6000" }], secrets: [{ name: "DATABASE_URL", valueFrom: "fixture-vault-reference" }], healthCheck: { command: ["CMD", "true"] } },
    { name: "sidecar", image: "registry.example/sidecar", environment: [{ name: "TODOS_RATE_LIMIT_MAX", value: "17" }] },
  ],
};

function runDeploy(rate = "60000", changedService = false) {
  const dir = mkdtempSync(join(tmpdir(), "todos-deploy-headroom-"));
  try {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "current.json"), JSON.stringify(current));
    writeFileSync(join(dir, "bin/aws"), `#!/usr/bin/python3
import os,sys,json,pathlib
p=pathlib.Path(os.environ['FIXTURE_DIR']);a=sys.argv[1:]
def arg(name): return a[a.index(name)+1]
if a[:2]==['ecs','describe-task-definition']:
 t=json.loads((p/'current.json').read_text())
 if arg('--task-definition')!=t['taskDefinitionArn']:
  t['containerDefinitions'][0]['environment'].append({'name':'UNRELATED_NEW_REVISION','value':'must-not-be-adopted'})
 print(json.dumps(t))
elif a[:2]==['ecs','describe-services']:
 print(os.environ['FIXTURE_LIVE_TASK'])
elif a[:2]==['ecs','register-task-definition']:
 (p/'registered.json').write_text(arg('--cli-input-json'))
 print('arn:aws:ecs:us-east-1:000000000000:task-definition/todos-fixture:96')
elif a[:2]==['ecs','update-service']:
 (p/'updated').write_text('yes');print('{}')
elif a[:3]==['ecs','wait','services-stable']: pass
else: sys.exit(93)
`, { mode: 0o755 });
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = Bun.spawnSync(["bash", "-c", asText(deploy.run)], {
      cwd: join(root, "apps/todos"),
      env: { PATH: join(dir, "bin") + ":" + process.env.PATH, HOME: dir, FIXTURE_DIR: dir,
        FIXTURE_LIVE_TASK: changedService ? previous.replace(":94", ":95") : previous,
        IMAGE: image, CLUSTER: "fixture-cluster", SERVICE: "fixture-service", WEB_FAMILY: "todos-fixture", WEB_CONTAINER: "web",
        PREVIOUS_TASK_DEFINITION: previous, API_RATE_LIMIT_MAX: rate, GITHUB_OUTPUT: output },
      stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    let registered: typeof current | null = null;
    try { registered = JSON.parse(readFileSync(join(dir, "registered.json"), "utf8")); } catch {}
    return { exitCode: result.exitCode, registered, output: readFileSync(output, "utf8") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Todos production request headroom", () => {
  test("the manifest defaults to 60000 and accepts only bounded JSON integers", () => {
    const step = steps.find(step => asText(step.name) === "Resolve manifest and fail closed on production target mismatch")!;
    const assignment = asText(step.run).match(/api_rate_limit_max="\$\(jq -er '[\s\S]*?' <<<"\$\{manifest\}"\)"/)?.[0];
    expect(assignment).toBeDefined();
    for (const [manifest, expected] of [
      [{}, "60000"], [{ api_rate_limit_max: 1 }, "1"], [{ api_rate_limit_max: 12000 }, "12000"], [{ api_rate_limit_max: 1000000 }, "1000000"],
      ...[null, false, "60000", "60000oops", 0, -1, 1.5, 1000001].map(value => [{ api_rate_limit_max: value }, null]),
    ] as const) {
      const result = Bun.spawnSync(["bash", "-e", "-c", assignment + '\nprintf "%s" "$api_rate_limit_max"'], {
        env: { PATH: process.env.PATH, manifest: JSON.stringify(manifest) }, stdout: "pipe", stderr: "pipe",
      });
      if (expected === null) expect(result.exitCode).not.toBe(0);
      else { expect(result.exitCode).toBe(0); expect(result.stdout.toString()).toBe(expected); }
    }
  });

  test("live verification refuses a stale, missing, duplicated or conflicting environment budget", () => {
    const step = steps.find(step => asText(step.name) === "Verify exact live task definition, digest, and health")!;
    const check = asText(step.run).match(/jq -e --arg c "\$\{WEB_CONTAINER\}" --arg limit "\$\{API_RATE_LIMIT_MAX\}" '[\s\S]*?' <<<"\$\{deployed_definition\}" >\/dev\/null/)?.[0];
    expect(check).toBeDefined();
    const canonical = { name: "HASNA_TODOS_RATE_LIMIT_MAX", value: "60000" };
    for (const [environment, allowed] of [
      [[canonical], true], [[], false], [[{ ...canonical, value: "6000" }], false],
      [[canonical, canonical], false], [[canonical, { name: "TODOS_RATE_LIMIT_MAX", value: "6000" }], false],
    ] as const) {
      const result = Bun.spawnSync(["bash", "-e", "-c", check!], { env: {
        PATH: process.env.PATH, WEB_CONTAINER: "web", API_RATE_LIMIT_MAX: "60000",
        deployed_definition: JSON.stringify({ taskDefinition: { containerDefinitions: [{ name: "web", environment }] } }),
      }, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode === 0).toBe(allowed);
    }
  });

  test("the actual deploy step raises the budget on the captured live definition and preserves other settings", () => {
    const result = runDeploy();
    expect(result.exitCode).toBe(0);
    const registered = result.registered!;
    expect(registered.containerDefinitions[0]!.environment).toEqual([
      { name: "KEEP", value: "unchanged" }, { name: "HASNA_TODOS_RATE_LIMIT_MAX", value: "60000" },
    ]);
    expect(registered.containerDefinitions[0]!.image).toBe(image);
    expect(registered.containerDefinitions[0]!.secrets).toEqual(current.containerDefinitions[0]!.secrets);
    expect(registered.containerDefinitions[0]!.healthCheck).toEqual(current.containerDefinitions[0]!.healthCheck);
    expect(registered.containerDefinitions[1]).toEqual(current.containerDefinitions[1]);
    expect(registered.cpu).toBe(current.cpu);
    expect(registered.memory).toBe(current.memory);
    expect(registered.runtimePlatform).toEqual(current.runtimePlatform);
    expect(registered).not.toHaveProperty("taskDefinitionArn");
    expect(registered).not.toHaveProperty("revision");
  });

  test("a concurrent service revision refuses before registering or updating", () => {
    const result = runDeploy("60000", true);
    expect(result.exitCode).not.toBe(0);
    expect(result.registered).toBeNull();
    expect(result.output).not.toContain("service_mutated=true");
  });

  test("invalid runtime budgets refuse before registering or updating", () => {
    for (const rate of ["", "0", "-1", "3.5", "60000oops", "NaN", "1000001"]) {
      const result = runDeploy(rate);
      expect(result.exitCode).not.toBe(0);
      expect(result.registered).toBeNull();
    }
  });
});
