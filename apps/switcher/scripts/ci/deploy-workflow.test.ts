import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "deploy-switcher.yml"),
  "utf8",
);
const rolloutVerifier = join(import.meta.dir, "verify-ecs-rollout.sh");

function runRolloutVerifier(
  responses: Array<{ rolloutState: string; taskDefinition: string; status?: string }>,
  expectedTaskDefinition = "arn:aws:ecs:us-east-1:123456789012:task-definition/switcher-prod:12",
) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "switcher-rollout-"));
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
      cmd: ["bash", rolloutVerifier, "switcher-prod", "switcher-prod", expectedTaskDefinition],
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
  test("is a discoverable Switcher root lane bound to successful ci and the member path", () => {
    expect(workflow).toContain("name: deploy-switcher");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [ci]");
    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).toContain("group: deploy-switcher-production");
    expect(workflow).toContain('DEPLOY_PATH_SCOPE: "apps/switcher/**"');
    expect(workflow).toContain("SWITCHER_DEPLOY_ENABLED");
    expect(workflow).toContain("::warning title=Switcher deploy held::");
  });


  test("binds automatic and manual deploys to successful ci for the exact main commit", () => {
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("permissions:\n      contents: read\n      actions: read");
    expect(workflow).toContain("needs.gate.outputs.proceed == 'true'");
    expect(workflow).toContain("head_sha=${source_sha}");
    expect(workflow).toContain("conclusion == \"success\"");
  });

  test("pins the Switcher production targets and OIDC role", () => {
    expect(workflow).toContain("DEPLOY_MANIFEST: /hasna/deploy/switcher");
    expect(workflow).toContain("EXPECTED_CLUSTER: oss-fleet-prod");
    expect(workflow).toContain("EXPECTED_SERVICE: switcher-prod");
    expect(workflow).toContain("EXPECTED_WEB_FAMILY: switcher-prod");
    expect(workflow).toContain("EXPECTED_ECR_REPOSITORY: switcher");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: switcher-prod-migrate");
    expect(workflow).toContain("LOCAL_IMAGE: switcher-deploy-candidate");
    expect(workflow).toContain("role/switcher-prod-gha-deploy");
    expect(workflow).toContain("PUBLIC_BASE_URL: https://api.hasna.com/switcher");
  });

  test("builds the member image from the monorepo layout, not a repo-root Dockerfile", () => {
    // The monorepo root has no Dockerfile; the member one lives at
    // apps/switcher/Dockerfile. A deploy step that runs `docker build .` from
    // the repo root would fail before ECR is ever reached, so the deploy job
    // must pin the run working-directory to the member directory.
    expect(workflow).toContain("defaults:");
    expect(workflow).toContain("run:");
    expect(workflow).toContain("working-directory: apps/switcher");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run build");
    expect(workflow).toContain("--platform linux/arm64");
    expect(workflow).toContain("--target runtime");
    expect(workflow).toContain("dist/serve/index.js --version");
  });

  test("resolves scripts/ci helpers from the member directory", () => {
    // verify-ecs-rollout.sh and redact-log-lines.mjs live under
    // apps/switcher/scripts/ci/ in the monorepo. The workflow invokes them by
    // their standalone-repo-relative paths (`scripts/ci/...`), which resolve
    // only when the run working-directory is apps/switcher.
    const scriptsBlock = workflow.slice(workflow.indexOf("working-directory: apps/switcher"));
    expect(scriptsBlock).toContain("bash scripts/ci/verify-ecs-rollout.sh");
    expect(scriptsBlock).toContain("node scripts/ci/redact-log-lines.mjs");
  });

  test("supports the zero-desired-count bootstrap migration without claiming activation", () => {
    expect(workflow).toContain("desiredCount | numbers");
    expect(workflow).toContain("bootstrap=true");
    expect(workflow).toContain("printf 'bootstrap=%s\\n'");
    expect(workflow).toContain("if: steps.before.outputs.bootstrap != 'true'");
    expect(workflow).toContain("Verify staged bootstrap image provenance and scan");
    expect(workflow).toContain('expected_tag="deploy-${SOURCE_SHA}-bootstrap"');
    expect(workflow).toContain("steps.bootstrap-image.outputs.digest_image");
    expect(workflow).toContain("Emit exact bootstrap migration receipt");
    expect(workflow).toContain("hasna.switcher.migration_receipt.v1");
    expect(workflow).toContain("migration-receipt.json");
    expect(workflow).toContain("MIGRATION_RECEIPT_PARAMETER: /hasna/deploy/switcher/migration-receipt");
    expect(workflow).toContain("aws ssm put-parameter --cli-input-json file://migration-receipt-request.json");
    expect(workflow).toContain("needs.deploy.outputs.activated == 'true'");
  });

  test("verifies the public boundary and provisions the fleet key only after deploy", () => {
    const publicVerifier = readFileSync(join(import.meta.dir, "verify-public-api.sh"), "utf8");
    expect(workflow).toContain('bash scripts/ci/verify-public-api.sh "${PUBLIC_BASE_URL}" "${expected_version}" --wait-for-route');
    expect(publicVerifier).toContain('request /ready');
    expect(publicVerifier).toContain('request /version');
    expect(publicVerifier).toContain('request /v1/providers');
    expect(publicVerifier).toContain('anonymous Switcher API request was not denied by authentication');
    expect(workflow).toContain('needs: [gate, deploy]');
    expect(workflow).toContain('uses: ./.github/workflows/fleet-key-provision.yml');
    expect(workflow).toContain('app: switcher');
    expect(workflow).not.toContain('aws secretsmanager get-secret-value');
  });

  test("registers Switcher as a hosted monorepo app and ported deploy lane", () => {
    const registry = JSON.parse(readFileSync(join(repoRoot, "tooling", "fleet", "hosted-apps.json"), "utf8"));
    expect(registry.apps.filter((entry: { app: string }) => entry.app === "switcher")).toEqual([
      { app: "switcher", source: "monorepo", probePath: "/v1/providers" },
    ]);
    const laneGate = readFileSync(join(repoRoot, "tooling", "ci", "check-deploy-lanes.ts"), "utf8");
    expect(laneGate).toContain('"projects", "skills", "switcher"');
  });

  test("scans before AWS authentication and emits Switcher-specific evidence", () => {
    expect(workflow.indexOf("Generate local vulnerability report")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Configure AWS credentials with GitHub OIDC")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Generate local vulnerability report")).toBeLessThan(
      workflow.indexOf("Configure AWS credentials with GitHub OIDC"),
    );
    expect(workflow).toContain('--started-by "gha-switcher-migrate-${GITHUB_RUN_ID}"');
    expect(workflow).toContain('schema:"hasna.switcher.production_deploy.v1"');
    expect(workflow).toContain("name: switcher-production-deploy-${{ github.run_id }}");
    expect(workflow).toContain("apps/switcher/deploy-evidence.json");
    expect(workflow).toContain("## Switcher production deployment");
  });
});

describe("deploy rollout verification", () => {
  const expectedTaskDefinition =
    "arn:aws:ecs:us-east-1:123456789012:task-definition/switcher-prod:12";

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
        taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/switcher-prod:11",
      },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(
      "::error::live task def (arn:aws:ecs:us-east-1:123456789012:task-definition/switcher-prod:11) != deployed",
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
