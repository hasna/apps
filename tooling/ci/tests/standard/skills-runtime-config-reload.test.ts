import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const workflow = () => Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows/deploy-skills.yml"), "utf8")) as any;

function manifestEnvironment(target: string, entries: Record<string, unknown>) {
  const script = workflow().jobs.deploy.steps.find((step: any) => step.name === "Load deploy manifest").run;
  const filter = script.match(/environment="\$\(jq -ce --arg target "\$target" '([\s\S]+?)' <<<"\$M"\)"/)?.[1];
  expect(typeof filter).toBe("string");
  return spawnSync("jq", ["-ce", "--arg", "target", target, filter], { input: JSON.stringify({ [`${target}_environment`]: entries }), encoding: "utf8", timeout: 5_000 });
}

test("Skills manifest admits bounded decimal API request limits only for the web service", () => {
  const key = "HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES";
  for (const value of ["1000000", "5000000", "8388608"]) {
    const result = manifestEnvironment("web", { [key]: value, HASNA_SKILLS_S3_RUN_PREFIX: "runs" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ [key]: value, HASNA_SKILLS_S3_RUN_PREFIX: "runs" });
  }
  for (const value of [0, 8388608, null, {}, "", "0", "-1", "08388608", " 8388608", "8388608.0", "8e6", "8388609", "99999999"]) {
    expect(manifestEnvironment("web", { [key]: value }).status).not.toBe(0);
  }
  for (const target of ["worker", "migration", "runtime"]) expect(manifestEnvironment(target, { [key]: "8388608" }).status).not.toBe(0);
  expect(manifestEnvironment("web", { UNKNOWN_OVERRIDE: "8388608" }).status).not.toBe(0);
  expect(manifestEnvironment("worker", { HASNA_SKILLS_RUNTIME_CONFIG: "{}" }).status).not.toBe(0);
  expect(manifestEnvironment("worker", { HASNA_SKILLS_S3_RUN_PREFIX: "runs" }).status).toBe(0);
});

test("Skills API deployment replaces only its selected nonsecret request limit", () => {
  const steps = workflow().jobs.deploy.steps;
  const web = steps.find((step: any) => step.name === "Deploy API service");
  expect(web.env.ENVIRONMENT_OVERRIDES).toBe("${{ steps.m.outputs.web_environment }}");
  expect(steps.find((step: any) => step.name === "Deploy worker service").env.ENVIRONMENT_OVERRIDES).toBe("${{ steps.m.outputs.worker_environment }}");
  const migration = steps.find((step: any) => step.name === "Run database migration");
  expect(migration.env.ENVIRONMENT_OVERRIDES).toBeUndefined();
  expect(migration.run).not.toContain("ENVIRONMENT_OVERRIDES");
  const filter = web.run.match(/--argjson overrides "\$ENVIRONMENT_OVERRIDES" '([\s\S]+?)'\)"/)?.[1];
  expect(typeof filter).toBe("string");
  const key = "HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES";
  const other = { name: "sidecar", image: "existing-sidecar", environment: [{ name: "OTHER", value: "keep" }] };
  const input = { taskDefinitionArn: "previous", revision: 1, containerDefinitions: [{ name: "skills", image: "existing-api", environment: [{ name: key, value: "5000000" }, { name: "OTHER", value: "keep" }], secrets: [{ name: "SECRET_REFERENCE", valueFrom: "fixture-reference" }] }, other] };
  const run = () => spawnSync("jq", ["-ce", "--arg", "img", "reviewed-api", "--arg", "c", "skills", "--argjson", "overrides", JSON.stringify({ [key]: "8388608" }), filter], { input: JSON.stringify(input), encoding: "utf8", timeout: 5_000 });
  const result = run(); expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.containerDefinitions[0]).toEqual({ ...input.containerDefinitions[0], image: "reviewed-api", environment: [{ name: "OTHER", value: "keep" }, { name: key, value: "8388608" }] });
  expect(output.containerDefinitions[1]).toEqual(other);
  expect(output.taskDefinitionArn).toBeUndefined(); expect(output.revision).toBeUndefined();
  input.containerDefinitions[0]!.secrets!.push({ name: key, valueFrom: "fixture-conflicting-reference" });
  expect(run().status).not.toBe(0);
});

test("Skills configuration reload cannot rebuild or push an immutable API source tag", () => {
  const steps = workflow().jobs.deploy.steps;
  const needs = { gate: { outputs: { reload_runtime_config: "true" } } };
  const active = steps.filter((step: any) => !step.if || new Function("needs", `return Boolean(${step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(needs));
  expect(active.map((step: any) => step.name)).not.toContain("Build native ARM64 image locally");
  expect(active.map((step: any) => step.name)).not.toContain("Push scanned image");
  expect(active.map((step: any) => step.name)).not.toContain("Run database migration");
  expect(active.map((step: any) => step.name)).toContain("Verify published API digest and activation manifest");
});

test("normal Skills deployment still builds and scans before credentials and push", () => {
  const steps = workflow().jobs.deploy.steps;
  const needs = { gate: { outputs: { reload_runtime_config: "false" } } };
  const active = steps.filter((step: any) => !step.if || new Function("needs", `return Boolean(${step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(needs));
  const names = active.map((step: any) => step.name);
  const expected = ["Build native ARM64 image locally", "Generate local vulnerability report", "Enforce local vulnerability gate", "Configure AWS credentials", "Push scanned image", "Run database migration", "Deploy API service"];
  expect(expected.map(name => names.indexOf(name))).toEqual([...expected.map(name => names.indexOf(name))].sort((a, b) => a - b));
  expect(expected.every(name => names.includes(name))).toBe(true);
  expect(names).not.toContain("Verify published API digest and activation manifest");
});

test("reload provenance stays in the credential-free gate and both services use the resolved digest", () => {
  const document = workflow();
  expect(document.on.workflow_dispatch.inputs.reload_runtime_config).toMatchObject({ type: "boolean", default: false });
  expect(document.jobs.gate.permissions).toEqual({ contents: "read", actions: "read" });
  const step = document.jobs.gate.steps.find((step: any) => step.id === "reload");
  expect(step.run).toBe("python3 -I -B tooling/ci/skills-runtime-config-reload.py gate");
  expect(document.jobs.gate.outputs.reload_runtime_config).toBe("${{ steps.reload.outputs.reload_runtime_config }}");
  expect(document.jobs.deploy.steps.find((step: any) => step.id === "reuse").run).toBe("python3 -I -B ../../tooling/ci/skills-runtime-config-reload.py image");
  for (const name of ["Deploy API service", "Deploy worker service"])
    expect(document.jobs.deploy.steps.find((step: any) => step.name === name).env.IMAGE).toBe("${{ steps.reuse.outputs.image || steps.build.outputs.image }}");
});

test("real reload verifier rejects forged provenance and image bindings offline", () => {
  for (const optimized of [false, true]) {
    const result = spawnSync("python3", [optimized ? "-OB" : "-B", resolve(root, "tooling/ci/tests/skills-runtime-config-reload.test.py")], { cwd: root, encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("OK");
  }
});
