import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const workflow = Bun.YAML.parse(
  readFileSync(
    resolve(import.meta.dir, "../../../../.github/workflows/deploy-skills.yml"),
    "utf8",
  ),
) as any;
describe("isolated runtime publication and environment overrides", () => {
  test("runtime publication stays bound to gated source and scans before AWS credentials", () => {
    const job = workflow.jobs.runtime_image;
    expect(job.needs).toEqual(["gate", "deploy"]);
    expect(job.if).toContain("needs.gate.outputs.proceed == 'true'");
    expect(job.if).toContain("needs.deploy.outputs.runtime_ecr_url != ''");
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
    const push = steps.findIndex((s) => s.id === "publish");
    expect(scan).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(scan);
    expect(credentials).toBeGreaterThan(gate);
    expect(push).toBeGreaterThan(credentials);
    expect(steps[scan].with["ignore-unfixed"]).toBe(false);
    expect(steps[gate].run).toContain("critical > 0 || high > 0");
    expect(steps[push].env.RUNTIME_ECR_URL).toBe(
      "${{ needs.deploy.outputs.runtime_ecr_url }}",
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
      deploy: { outputs: { runtime_ecr_url: "configured" } },
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
