import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const workflow = Bun.YAML.parse(
  readFileSync(
    resolve(import.meta.dir, "../../../../.github/workflows/deploy-skills.yml"),
    "utf8",
  ),
) as any;
describe("isolated runtime publication and environment overrides", () => {
  test("masked registry identifiers do not suppress runtime publication", async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-runtime-handoff-"));
    try {
      const secret = "masked-registry.example";
      const repository = `${secret}/skills-runtime`;
      const manifest = {
        cluster: "fixture", service: "fixture", web_task_family: "fixture",
        web_container: "web", migration_task_family: "fixture",
        migration_container: "migrate", ecr_repository_url: "api.example/fixture",
        assign_public_ip: "ENABLED", subnets: ["fixture-subnet"],
        security_groups: ["fixture-sg"], worker_service: "fixture",
        worker_task_family: "fixture", worker_container: "worker",
        health_url: "https://fixture.example/health",
      };
      writeFileSync(join(root, "aws"), `#!/bin/sh
test "$*" = 'ssm get-parameter --name /fixture/skills --query Parameter.Value --output text' || exit 91
printf '%s\\n' "$FIXTURE_MANIFEST"
`, { mode: 0o755 });
      async function runStep(step: any, extra: Record<string, unknown>, fallback = "") {
        const output = join(root, "output");
        writeFileSync(output, "");
        const child = Bun.spawn(["bash", "-c", step.run], {
          cwd: root,
          env: {
            PATH: `${root}:${process.env.PATH}`, HOME: root,
            DEPLOY_MANIFEST: "/fixture/skills", GITHUB_OUTPUT: output,
            FIXTURE_MANIFEST: JSON.stringify({ ...manifest, ...extra }),
            VAR_RUNTIME_ECR_URL: fallback,
          },
          stdin: "ignore", stdout: "pipe", stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        expect(stdout + stderr).not.toContain(secret);
        const outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n")
          .filter(Boolean).map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
        return { code, stderr, outputs };
      }
      const deploy = workflow.jobs.deploy;
      const runtime = workflow.jobs.runtime_image;
      const enabled = new Function("github", "inputs", "needs",
        `return Boolean(${runtime.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`);
      const load = deploy.steps.find((step: any) => step.id === "m");
      for (const [extra, fallback, configured] of [
        [{ runtime_ecr_repository_url: repository }, "fallback.example/runtime", true],
        [{}, repository, true],
        [{}, "", false],
      ] as const) {
        const result = await runStep(load, extra, fallback);
        expect(result.code, result.stderr).toBe(0);
        // GitHub drops job outputs containing masked values, including an AWS
        // account identifier inside an ECR URL. Step outputs within one job
        // remain available. Apply that observed boundary to the actual mapping.
        const transferred: Record<string, string> = {};
        for (const [name, expression] of Object.entries(deploy.outputs)) {
          const key = String(expression).match(/^\$\{\{ steps\.m\.outputs\.([a-z_]+) \}\}$/)?.[1];
          expect(key).toBeDefined();
          const value = result.outputs[key!];
          transferred[name] = value && !value.includes(secret) ? value : "";
        }
        expect(enabled({ event_name: "workflow_run" }, {}, {
          gate: { outputs: { proceed: "true" } }, deploy: { outputs: transferred },
        })).toBe(configured);
        expect(Object.values(transferred)).toEqual([String(configured)]);
      }
      const resolver = runtime.steps.find((step: any) => step.id === "runtime_repository");
      expect(resolver).toBeDefined();
      const fromManifest = await runStep(resolver, { runtime_ecr_repository_url: repository }, "fallback.example/runtime");
      expect(fromManifest.code, fromManifest.stderr).toBe(0);
      expect(fromManifest.outputs.runtime_ecr_url).toBe(repository);
      const fromFallback = await runStep(resolver, {}, repository);
      expect(fromFallback.code, fromFallback.stderr).toBe(0);
      expect(fromFallback.outputs.runtime_ecr_url).toBe(repository);
      const absent = await runStep(resolver, {}, "");
      expect(absent.code).not.toBe(0);
      expect(absent.outputs).toEqual({});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("runtime publication stays bound to gated source and scans before AWS credentials", () => {
    const job = workflow.jobs.runtime_image;
    expect(job.needs).toEqual(["gate", "deploy"]);
    expect(job.if).toContain("needs.gate.outputs.proceed == 'true'");
    expect(job.if).toContain("needs.deploy.outputs.runtime_configured == 'true'");
    const steps = job.steps as any[];
    expect(
      steps.find((s) => s.uses?.startsWith("actions/checkout@"))?.with.ref,
    ).toBe("${{ needs.gate.outputs.source_sha }}");
    const scan = steps.findIndex((s) =>
      s.uses?.startsWith("aquasecurity/trivy-action@"),
    );
    const gate = steps.findIndex(
      (s) => s.name === "Enforce runtime vulnerability gate",
    );
    const credentials = steps.findIndex((s) =>
      s.uses?.startsWith("aws-actions/configure-aws-credentials@"),
    );
    const repository = steps.findIndex((s) => s.id === "runtime_repository");
    const push = steps.findIndex((s) => s.id === "publish");
    expect(scan).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(scan);
    expect(credentials).toBeGreaterThan(gate);
    expect(repository).toBeGreaterThan(credentials);
    expect(push).toBeGreaterThan(repository);
    expect(steps[repository].env.DEPLOY_MANIFEST).toBe(
      workflow.jobs.deploy.steps.find((s: any) => s.id === "m").env.DEPLOY_MANIFEST,
    );
    expect(steps[repository].env.VAR_RUNTIME_ECR_URL).toBe(
      "${{ vars.RUNTIME_ECR_REPOSITORY_URL }}",
    );
    expect(steps[scan].with["ignore-unfixed"]).toBe(false);
    expect(steps[gate].run).toContain("critical > 0 || high > 0");
    expect(steps[push].env.RUNTIME_ECR_URL).toBe(
      "${{ steps.runtime_repository.outputs.runtime_ecr_url }}",
    );
    expect(steps.map((s) => s.run ?? "").join("\n")).not.toMatch(
      /aws ecs (run-task|register-task-definition|update-service)/,
    );
    for (const step of steps)
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  });
  test("only an explicit manual activation skips runtime publication", () => {
    expect(
      workflow.on.workflow_dispatch.inputs.publish_runtime_image,
    ).toMatchObject({ type: "boolean", default: true });
    const expression = workflow.jobs.runtime_image.if.replace(
      /^\$\{\{\s*|\s*\}\}$/g,
      "",
    );
    const enabled = new Function(
      "github",
      "inputs",
      "needs",
      `return Boolean(${expression});`,
    );
    const needs = {
      gate: { outputs: { proceed: "true" } },
      deploy: { outputs: { runtime_configured: "true" } },
    };
    expect(enabled({ event_name: "workflow_run" }, {}, needs)).toBe(true);
    expect(
      enabled(
        { event_name: "workflow_run" },
        { publish_runtime_image: false },
        needs,
      ),
    ).toBe(true);
    expect(
      enabled(
        { event_name: "workflow_dispatch" },
        { publish_runtime_image: true },
        needs,
      ),
    ).toBe(true);
    expect(
      enabled(
        { event_name: "workflow_dispatch" },
        { publish_runtime_image: false },
        needs,
      ),
    ).toBe(false);
    expect(workflow.jobs.deploy.if).toBe(
      "${{ needs.gate.outputs.proceed == 'true' }}",
    );
    expect(workflow.jobs.gate.if).not.toContain("publish_runtime_image");
    expect(workflow.jobs.provision_key.if).not.toContain(
      "publish_runtime_image",
    );
  });
  test("task environment merge preserves other values and refuses secret collisions", async () => {
    const jq = Bun.which("jq");
    if (!jq)
      throw new Error(
        "jq is required to verify the deployment environment merge",
      );
    for (const name of ["Deploy API service", "Deploy worker service"]) {
      const script = workflow.jobs.deploy.steps.find(
        (s: any) => s.name === name,
      ).run as string;
      const expression = script.match(
        /--argjson overrides "\$ENVIRONMENT_OVERRIDES" '([\s\S]*?)'\)/,
      )?.[1];
      expect(expression).toBeDefined();
      const task = {
        family: "synthetic",
        revision: 1,
        containerDefinitions: [
          {
            name: "api",
            image: "old",
            environment: [
              { name: "KEEP", value: "kept" },
              { name: "HASNA_SKILLS_S3_RUN_PREFIX", value: "old" },
            ],
            secrets: [
              { name: "SIGNING_REFERENCE", valueFrom: "synthetic-reference" },
            ],
          },
        ],
      };
      async function merge(overrides: Record<string, string>) {
        const child = Bun.spawn(
          [
            jq!,
            "--arg",
            "img",
            "sha256:" + "a".repeat(64),
            "--arg",
            "c",
            "api",
            "--argjson",
            "overrides",
            JSON.stringify(overrides),
            expression!,
          ],
          {
            stdin: new Blob([JSON.stringify(task)]),
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { stdout, stderr, code };
      }
      const result = await merge({
        HASNA_SKILLS_S3_RUN_PREFIX: "run-artifacts",
      });
      expect(result.code, result.stderr).toBe(0);
      const container = JSON.parse(result.stdout).containerDefinitions[0];
      expect(container.environment).toEqual([
        { name: "KEEP", value: "kept" },
        { name: "HASNA_SKILLS_S3_RUN_PREFIX", value: "run-artifacts" },
      ]);
      expect(container.secrets).toEqual(task.containerDefinitions[0]!.secrets);
      const collision = await merge({ SIGNING_REFERENCE: "override" });
      expect(collision.code).not.toBe(0);
      expect(collision.stderr).toContain("collides with a secret reference");
    }
  });
});
