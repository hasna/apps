import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflow = readFileSync(
  join(import.meta.dir, "..", "..", "..", "..", ".github", "workflows", "deploy-projects.yml"),
  "utf8",
);
const rolloutVerifier = join(import.meta.dir, "verify-ecs-rollout.sh");

function runRolloutVerifier(
  responses: Array<{ rolloutState: string; taskDefinition: string; status?: string }>,
  expectedTaskDefinition = "arn:aws:ecs:us-east-1:123456789012:task-definition/projects-prod:12",
) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "projects-rollout-"));
  const binDir = join(fixtureRoot, "bin");
  mkdirSync(binDir);
  writeFileSync(
    join(binDir, "aws"),
    `#!/usr/bin/env bash
set -euo pipefail
count_file="$AWS_FIXTURE_DIR/count"
count="$(cat "$count_file")"
next=$((count + 1))
printf '%s' "$next" > "$count_file"
fixture="$AWS_FIXTURE_DIR/$next.json"
if [ ! -f "$fixture" ]; then
  fixture="$AWS_FIXTURE_DIR/last.json"
fi
cat "$fixture"
`,
  );
  chmodSync(join(binDir, "aws"), 0o755);
  writeFileSync(join(fixtureRoot, "count"), "0");

  for (const [index, response] of responses.entries()) {
    const service = {
      services: [
        {
          deployments: [
            {
              status: response.status ?? "PRIMARY",
              rolloutState: response.rolloutState,
              taskDefinition: response.taskDefinition,
            },
          ],
        },
      ],
    };
    writeFileSync(join(fixtureRoot, `${index + 1}.json`), JSON.stringify(service));
  }
  writeFileSync(
    join(fixtureRoot, "last.json"),
    readFileSync(join(fixtureRoot, `${responses.length}.json`)),
  );

  try {
    return Bun.spawnSync({
      cmd: ["bash", rolloutVerifier, "projects-prod", "projects-prod", expectedTaskDefinition],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        AWS_FIXTURE_DIR: fixtureRoot,
        ROLLOUT_VERIFY_DELAY_SECONDS: "0",
        ROLLOUT_VERIFY_MAX_ATTEMPTS: String(responses.length),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe("deploy migration failure evidence", () => {
  test("keeps migration and circuit-breaker gates intact", () => {
    expect(workflow).toContain('if [[ "${exit_code}" != "0" ]]; then');
    expect(workflow).toContain(
      'bash scripts/ci/verify-ecs-rollout.sh "${CLUSTER}" "${SERVICE}" "${deployed_task_definition}"',
    );
  });

  test("reports exact ECS and awslogs coordinates before failing", () => {
    expect(workflow).toContain("taskDefinitionArn");
    expect(workflow).toContain("stopCode");
    expect(workflow).toContain("containerReason=");
    expect(workflow).toContain("awslogs-group");
    expect(workflow).toContain("awslogs-region");
    expect(workflow).toContain("awslogs-stream-prefix");
    expect(workflow).toContain('log_stream="${log_prefix}/${MIGRATION_CONTAINER}/${task_id}"');
    expect(workflow).toContain('>> "${GITHUB_STEP_SUMMARY}"');
    expect(workflow).toContain("aws logs get-log-events");
    expect(workflow).toContain("| node scripts/ci/redact-log-lines.mjs");
  });

  test("does not print task environment or secret values", () => {
    expect(workflow).not.toContain(".containerDefinitions[].environment");
    expect(workflow).not.toContain(".containerDefinitions[].secrets");
    expect(workflow).not.toContain("aws secretsmanager get-secret-value");
  });
});

describe("monorepo deploy context (hasna/apps)", () => {
  test("is a discoverable Projects root lane bound to successful ci and the member path", () => {
    expect(workflow).toContain("name: deploy-projects");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [ci]");
    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).toContain("group: deploy-projects-production");
    expect(workflow).toContain('DEPLOY_PATH_SCOPE: "apps/projects/**"');
  });

  test("pins the Projects production targets and OIDC role", () => {
    expect(workflow).toContain("DEPLOY_MANIFEST: /hasna/deploy/projects");
    expect(workflow).toContain("EXPECTED_CLUSTER: oss-fleet-prod");
    expect(workflow).toContain("EXPECTED_SERVICE: projects-prod");
    expect(workflow).toContain("EXPECTED_ECR_REPOSITORY: projects");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: projects-prod-migrate");
    expect(workflow).toContain("LOCAL_IMAGE: projects-deploy-candidate");
    expect(workflow).toContain("role/projects-prod-gha-deploy");
  });

  test("builds the member image from the monorepo layout, not a repo-root Dockerfile", () => {
    // The monorepo root has no Dockerfile; the member one lives at
    // apps/projects/Dockerfile. A deploy step that runs `docker build .` from
    // the repo root would fail before ECR is ever reached, so the deploy job
    // must pin the run working-directory to the member directory.
    expect(workflow).toContain("defaults:");
    expect(workflow).toContain("run:");
    expect(workflow).toContain("working-directory: apps/projects");
    expect(workflow).toContain("--target runtime");
    expect(workflow).toContain("dist/serve/index.js --version");
  });

  test("resolves scripts/ci helpers from the member directory", () => {
    // verify-ecs-rollout.sh and redact-log-lines.mjs live under
    // apps/projects/scripts/ci/ in the monorepo. The workflow invokes them by
    // their standalone-repo-relative paths (`scripts/ci/...`), which resolve
    // only when the run working-directory is apps/projects.
    const scriptsBlock = workflow.slice(workflow.indexOf("working-directory: apps/projects"));
    expect(scriptsBlock).toContain("bash scripts/ci/verify-ecs-rollout.sh");
    expect(scriptsBlock).toContain("node scripts/ci/redact-log-lines.mjs");
  });

  test("scans before AWS authentication and emits Projects-specific evidence", () => {
    expect(workflow.indexOf("Generate local vulnerability report")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Configure AWS credentials with GitHub OIDC")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Generate local vulnerability report")).toBeLessThan(
      workflow.indexOf("Configure AWS credentials with GitHub OIDC"),
    );
    expect(workflow).toContain('--started-by "gha-projects-migrate-${GITHUB_RUN_ID}"');
    expect(workflow).toContain('schema:"hasna.projects.production_deploy.v1"');
    expect(workflow).toContain("name: projects-production-deploy-${{ github.run_id }}");
    expect(workflow).toContain("apps/projects/deploy-evidence.json");
    expect(workflow).toContain("## Projects production deployment");
  });
});

describe("deploy rollout verification", () => {
  const expectedTaskDefinition =
    "arn:aws:ecs:us-east-1:123456789012:task-definition/projects-prod:12";

  test("waits for delayed rolloutState convergence when the exact task definition is live", () => {
    const result = runRolloutVerifier([
      { rolloutState: "IN_PROGRESS", taskDefinition: expectedTaskDefinition },
      { rolloutState: "COMPLETED", taskDefinition: expectedTaskDefinition },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      `primary rolloutState=IN_PROGRESS liveTaskDef=${expectedTaskDefinition} deployed=${expectedTaskDefinition}`,
    );
    expect(result.stdout.toString()).toContain(
      `primary rolloutState=COMPLETED liveTaskDef=${expectedTaskDefinition} deployed=${expectedTaskDefinition}`,
    );
  });

  test("rejects a completed circuit-breaker rollback to the previous task definition", () => {
    const result = runRolloutVerifier([
      {
        rolloutState: "COMPLETED",
        taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/projects-prod:11",
      },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "::error::live task def (arn:aws:ecs:us-east-1:123456789012:task-definition/projects-prod:11) != deployed",
    );
  });

  test("rejects a failed rollout even when the expected task definition remains PRIMARY", () => {
    const result = runRolloutVerifier([
      { rolloutState: "FAILED", taskDefinition: expectedTaskDefinition },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "::error::deployment did not complete (rolloutState=FAILED) — likely circuit-breaker rollback",
    );
  });

  test("rejects a response with no PRIMARY deployment", () => {
    const result = runRolloutVerifier([
      {
        status: "ACTIVE",
        rolloutState: "COMPLETED",
        taskDefinition: expectedTaskDefinition,
      },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "::error::unable to verify exactly one PRIMARY deployment (failures=0 primaryCount=0)",
    );
  });

  test("fails after the bounded verification window when rolloutState never converges", () => {
    const result = runRolloutVerifier([
      { rolloutState: "IN_PROGRESS", taskDefinition: expectedTaskDefinition },
      { rolloutState: "IN_PROGRESS", taskDefinition: expectedTaskDefinition },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "::error::deployment rolloutState remained IN_PROGRESS after 2 verification attempts",
    );
  });
});
