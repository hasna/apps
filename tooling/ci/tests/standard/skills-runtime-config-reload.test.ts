import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const workflow = () => Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows/deploy-skills.yml"), "utf8")) as any;

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
