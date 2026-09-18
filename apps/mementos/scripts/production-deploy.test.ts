import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const fixtureDirs: string[] = [];
const digest = `sha256:${"a".repeat(64)}`;
type ReadbackMode = "complete" | "lag-then-complete" | "permanently-bad";
type DeployFailureMode =
  | "none"
  | "migration-launch-fail"
  | "migration-wait-fail"
  | "migration-exit-fail"
  | "migration-wrong-task-definition"
  | "migration-wrong-digest"
  | "migration-missing-digest"
  | "missing-network"
  | "missing-capacity"
  | "update-fail"
  | "wait-fail"
  | "list-fail"
  | "malformed-list"
  | "detail-fail";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function service(taskDefinition: string) {
  return {
    failures: [],
    services: [
      {
        status: "ACTIVE",
        taskDefinition,
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
        capacityProviderStrategy: [
          { capacityProvider: "FARGATE", weight: 1, base: 0 },
        ],
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: ["subnet-0123456789abcdef0"],
            securityGroups: ["sg-0123456789abcdef0"],
            assignPublicIp: "ENABLED",
          },
        },
        deployments: [
          {
            status: "PRIMARY",
            rolloutState: "COMPLETED",
            taskDefinition,
          },
        ],
      },
    ],
  };
}

function laggingService(taskDefinition: string) {
  const value = service(taskDefinition);
  value.services[0]!.deployments[0]!.rolloutState = "IN_PROGRESS";
  return value;
}

function taskDefinition(
  command: string[],
  environment: Array<{ name: string; value: string }> = [],
) {
  return {
    taskDefinition: {
      taskDefinitionArn:
        "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
      family: "mementos-prod",
      revision: 16,
      status: "ACTIVE",
      requiresAttributes: [],
      compatibilities: ["FARGATE"],
      containerDefinitions: [
        {
          name: "mementos",
          image: "example.invalid/mementos:previous",
          command,
          entryPoint: ["/entrypoint.sh"],
          ...(environment.length > 0 ? { environment } : {}),
        },
      ],
    },
  };
}

function migrationTaskDefinition() {
  return {
    taskDefinition: {
      taskDefinitionArn:
        "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:8",
      family: "mementos-prod-migrate",
      revision: 8,
      status: "ACTIVE",
      requiresAttributes: [],
      compatibilities: ["FARGATE"],
      containerDefinitions: [
        {
          name: "mementos-migrate",
          image: "example.invalid/mementos:previous-migration",
          command: ["mementos", "storage", "migrate"],
          secrets: [
            {
              name: "MIGRATION_DATABASE_URL",
              valueFrom:
                "arn:aws:secretsmanager:us-east-1:123456789012:secret:migration-owner",
            },
          ],
        },
      ],
    },
  };
}

function makeFixture(
  command: string[],
  liveEnv: Array<{ name: string; value: string }> = [],
) {
  const dir = mkdtempSync(resolve(tmpdir(), "mementos-production-deploy-"));
  fixtureDirs.push(dir);
  const fakeAws = resolve(dir, "aws");
  const fakeCurl = resolve(dir, "curl");
  const trace = resolve(dir, "trace.log");
  const state = resolve(dir, "updated.state");
  const readbackCount = resolve(dir, "readback-count.txt");
  const githubOutput = resolve(dir, "github-output.txt");
  const registerInputCapture = resolve(dir, "register-input.json");
  const migrationRegisterInputCapture = resolve(
    dir,
    "migration-register-input.json",
  );
  const migrationOverrideCapture = resolve(dir, "migration-overrides.json");
  const migrationNetworkCapture = resolve(dir, "migration-network.json");
  const migrationCapacityCapture = resolve(dir, "migration-capacity.json");

  writeJson(
    resolve(dir, "service-before.json"),
    service(
      "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
    ),
  );
  writeJson(
    resolve(dir, "service-after.json"),
    service(
      "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
    ),
  );
  writeJson(
    resolve(dir, "service-lagging.json"),
    laggingService(
      "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
    ),
  );
  writeJson(
    resolve(dir, "service-rollback.json"),
    service(
      "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
    ),
  );
  writeJson(
    resolve(dir, "service-drift.json"),
    service(
      "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:18",
    ),
  );
  writeJson(resolve(dir, "taskdef.json"), taskDefinition(command, liveEnv));
  writeJson(resolve(dir, "migration-taskdef.json"), migrationTaskDefinition());
  writeJson(resolve(dir, "image.json"), {
    imageDetails: [{ imageDigest: digest, imageTags: ["b".repeat(40)] }],
  });
  writeJson(resolve(dir, "register-service.json"), {
    taskDefinition: {
      ...taskDefinition(["mementos-deploy"]).taskDefinition,
      taskDefinitionArn:
        "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
      revision: 17,
      containerDefinitions: [
        {
          name: "mementos",
          image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/mementos@${digest}`,
          command: ["mementos-deploy"],
        },
      ],
    },
  });
  writeJson(resolve(dir, "register-migration.json"), {
    taskDefinition: {
      ...migrationTaskDefinition().taskDefinition,
      taskDefinitionArn:
        "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
      revision: 9,
      containerDefinitions: [
        {
          ...migrationTaskDefinition().taskDefinition.containerDefinitions[0],
          image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/mementos@${digest}`,
        },
      ],
    },
  });
  writeJson(resolve(dir, "update.json"), { service: { status: "ACTIVE" } });
  writeJson(resolve(dir, "task-list.json"), {
    taskArns: ["arn:aws:ecs:us-east-1:123456789012:task/mementos/fixture"],
  });
  writeJson(resolve(dir, "tasks.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
        containers: [
          { name: "mementos", lastStatus: "RUNNING", imageDigest: digest },
        ],
      },
    ],
  });
  writeJson(resolve(dir, "migration-run.json"), {
    failures: [],
    tasks: [
      {
        taskArn:
          "arn:aws:ecs:us-east-1:123456789012:task/fixture-cluster/migration-fixture",
      },
    ],
  });
  writeJson(resolve(dir, "migration-task-success.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
        stopCode: "EssentialContainerExited",
        stoppedReason: "Essential container in task exited",
        containers: [
          {
            name: "mementos-migrate",
            lastStatus: "STOPPED",
            exitCode: 0,
            imageDigest: digest,
          },
        ],
      },
    ],
  });
  writeJson(resolve(dir, "migration-task-failed.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
        stopCode: "EssentialContainerExited",
        stoppedReason: "Essential container in task exited",
        containers: [
          {
            name: "mementos-migrate",
            lastStatus: "STOPPED",
            exitCode: 1,
            reason: "migration refused unsafe legacy row",
            imageDigest: digest,
          },
        ],
      },
    ],
  });
  writeJson(resolve(dir, "migration-task-wrong-definition.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:10",
        stopCode: "EssentialContainerExited",
        containers: [
          {
            name: "mementos-migrate",
            lastStatus: "STOPPED",
            exitCode: 0,
            imageDigest: digest,
          },
        ],
      },
    ],
  });
  writeJson(resolve(dir, "migration-task-wrong-digest.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
        stopCode: "EssentialContainerExited",
        containers: [
          {
            name: "mementos-migrate",
            lastStatus: "STOPPED",
            exitCode: 0,
            imageDigest: `sha256:${"b".repeat(64)}`,
          },
        ],
      },
    ],
  });
  writeJson(resolve(dir, "migration-task-missing-digest.json"), {
    failures: [],
    tasks: [
      {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
        stopCode: "EssentialContainerExited",
        containers: [
          { name: "mementos-migrate", lastStatus: "STOPPED", exitCode: 0 },
        ],
      },
    ],
  });

  writeFileSync(
    fakeAws,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$TRACE_PATH"
case " $* " in
  *" ecs describe-services "*)
    case "$(cat "$STATE_PATH" 2>/dev/null || true)" in
      new)
        count="$(cat "$READBACK_COUNT_PATH" 2>/dev/null || printf '0')"
        count=$((count + 1))
        printf '%s\n' "$count" > "$READBACK_COUNT_PATH"
        case "\${READBACK_MODE:-complete}" in
          lag-then-complete)
            if [ "$count" -eq 1 ]; then
              sed -n '1,999p' "$FIXTURE_DIR/service-lagging.json"
            else
              sed -n '1,999p' "$FIXTURE_DIR/service-after.json"
            fi
            ;;
          permanently-bad) sed -n '1,999p' "$FIXTURE_DIR/service-lagging.json" ;;
          complete) sed -n '1,999p' "$FIXTURE_DIR/service-after.json" ;;
          *) printf 'unexpected readback mode: %s\n' "$READBACK_MODE" >&2; exit 97 ;;
        esac
        ;;
      previous) sed -n '1,999p' "$FIXTURE_DIR/service-rollback.json" ;;
      drift) sed -n '1,999p' "$FIXTURE_DIR/service-drift.json" ;;
      *) sed -n '1,999p' "$FIXTURE_DIR/service-before.json" ;;
    esac
    ;;
  *" ecs describe-task-definition "*)
    case "$*" in
      *"--task-definition mementos-prod-migrate"*) sed -n '1,999p' "$FIXTURE_DIR/migration-taskdef.json" ;;
      *) sed -n '1,999p' "$FIXTURE_DIR/taskdef.json" ;;
    esac
    ;;
  *" ecr describe-images "*) sed -n '1,999p' "$FIXTURE_DIR/image.json" ;;
  *" ecs register-task-definition "*)
    for a in "$@"; do
      case "$a" in
        file://*)
          input="\${a#file://}"
          case "$(jq -r '.family' "$input")" in
            mementos-prod-migrate)
              cp "$input" "$MIGRATION_REGISTER_INPUT_CAPTURE_PATH"
              sed -n '1,999p' "$FIXTURE_DIR/register-migration.json"
              ;;
            mementos-prod)
              cp "$input" "$REGISTER_INPUT_CAPTURE_PATH"
              sed -n '1,999p' "$FIXTURE_DIR/register-service.json"
              ;;
            *) printf 'unexpected registered family\\n' >&2; exit 96 ;;
          esac
          ;;
      esac
    done
    ;;
  *" ecs run-task "*)
    if [ "\${DEPLOY_FAILURE_MODE:-none}" = "migration-launch-fail" ]; then
      printf 'simulated migration launch failure\n' >&2
      exit 71
    fi
    for a in "$@"; do
      case "$a" in
        file://*)
          f="\${a#file://}"
          if jq -e '.containerOverrides' "$f" >/dev/null 2>&1; then cp "$f" "$MIGRATION_OVERRIDE_CAPTURE_PATH"; fi
          if jq -e '.awsvpcConfiguration' "$f" >/dev/null 2>&1; then cp "$f" "$MIGRATION_NETWORK_CAPTURE_PATH"; fi
          if jq -e 'type == "array" and .[0].capacityProvider' "$f" >/dev/null 2>&1; then cp "$f" "$MIGRATION_CAPACITY_CAPTURE_PATH"; fi
          ;;
      esac
    done
    sed -n '1,999p' "$FIXTURE_DIR/migration-run.json"
    ;;
  *" ecs wait tasks-stopped "*)
    if [ "\${DEPLOY_FAILURE_MODE:-none}" = "migration-wait-fail" ]; then exit 72; fi
    ;;
  *" ecs update-service "*)
    case "$*" in
      *"mementos-prod:17"*)
        printf 'new\n' > "$STATE_PATH"
        if [ "\${DEPLOY_FAILURE_MODE:-none}" = "update-fail" ]; then exit 73; fi
        ;;
      *"mementos-prod:16"*)
        if [ "\${ROLLBACK_MODE:-restore}" = "drift" ]; then printf 'drift\n' > "$STATE_PATH"; else printf 'previous\n' > "$STATE_PATH"; fi
        ;;
      *) printf 'unexpected task definition: %s\n' "$*" >&2; exit 98 ;;
    esac
    sed -n '1,999p' "$FIXTURE_DIR/update.json"
    ;;
  *" ecs wait services-stable "*)
    if [ "$(cat "$STATE_PATH" 2>/dev/null || true)" = "new" ] && [ "\${DEPLOY_FAILURE_MODE:-none}" = "wait-fail" ]; then exit 74; fi
    ;;
  *" ecs list-tasks "*)
    if [ "\${DEPLOY_FAILURE_MODE:-none}" = "list-fail" ]; then exit 75; fi
    if [ "\${DEPLOY_FAILURE_MODE:-none}" = "malformed-list" ]; then printf 'not-json\n'; else sed -n '1,999p' "$FIXTURE_DIR/task-list.json"; fi
    ;;
  *" ecs describe-tasks "*)
    case "$*" in
      *"migration-fixture"*)
        case "\${DEPLOY_FAILURE_MODE:-none}" in
          migration-exit-fail) sed -n '1,999p' "$FIXTURE_DIR/migration-task-failed.json" ;;
          migration-wrong-task-definition) sed -n '1,999p' "$FIXTURE_DIR/migration-task-wrong-definition.json" ;;
          migration-wrong-digest) sed -n '1,999p' "$FIXTURE_DIR/migration-task-wrong-digest.json" ;;
          migration-missing-digest) sed -n '1,999p' "$FIXTURE_DIR/migration-task-missing-digest.json" ;;
          *) sed -n '1,999p' "$FIXTURE_DIR/migration-task-success.json" ;;
        esac
        ;;
      *)
        if [ "\${DEPLOY_FAILURE_MODE:-none}" = "detail-fail" ]; then exit 76; fi
        sed -n '1,999p' "$FIXTURE_DIR/tasks.json"
        ;;
    esac
    ;;
  *) printf 'unexpected aws call: %s\\n' "$*" >&2; exit 99 ;;
esac
`,
  );
  chmodSync(fakeAws, 0o755);

  const fakeSleep = resolve(dir, "sleep");
  writeFileSync(
    fakeSleep,
    `#!/bin/sh
set -eu
printf 'sleep %s\\n' "$*" >> "$TRACE_PATH"
`,
  );
  chmodSync(fakeSleep, 0o755);

  writeFileSync(
    fakeCurl,
    `#!/bin/sh
set -eu
printf 'curl %s\\n' "$*" >> "$TRACE_PATH"
case "$*" in
  *"/ready"*)
    if [ "\${HEALTH_MODE:-healthy}" = "readiness-failure" ]; then printf '503'; else printf '200'; fi
    ;;
  *) printf '200' ;;
esac
`,
  );
  chmodSync(fakeCurl, 0o755);

  return {
    dir,
    fakeAws,
    fakeCurl,
    trace,
    state,
    readbackCount,
    githubOutput,
    registerInputCapture,
    migrationRegisterInputCapture,
    migrationOverrideCapture,
    migrationNetworkCapture,
    migrationCapacityCapture,
  };
}

async function runDeploy(
  command: string[],
  readbackMode: ReadbackMode = "complete",
  liveEnv: Array<{ name: string; value: string }> = [],
  deployFailureMode: DeployFailureMode = "none",
  rollbackMode: "restore" | "drift" = "restore",
) {
  const fixture = makeFixture(command, liveEnv);
  if (
    deployFailureMode === "missing-network" ||
    deployFailureMode === "missing-capacity"
  ) {
    const servicePath = resolve(fixture.dir, "service-before.json");
    const serviceBody = JSON.parse(readFileSync(servicePath, "utf8"));
    if (deployFailureMode === "missing-network") {
      delete serviceBody.services[0].networkConfiguration;
    } else {
      delete serviceBody.services[0].capacityProviderStrategy;
    }
    writeJson(servicePath, serviceBody);
  }
  const proc = Bun.spawn(
    ["bash", resolve(root, "scripts/production-deploy.sh"), "deploy"],
    {
      cwd: root,
      env: {
        PATH: `${fixture.dir}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? fixture.dir,
        TRACE_PATH: fixture.trace,
        STATE_PATH: fixture.state,
        READBACK_COUNT_PATH: fixture.readbackCount,
        READBACK_MODE: readbackMode,
        FIXTURE_DIR: fixture.dir,
        GITHUB_OUTPUT: fixture.githubOutput,
        REGISTER_INPUT_CAPTURE_PATH: fixture.registerInputCapture,
        MIGRATION_REGISTER_INPUT_CAPTURE_PATH:
          fixture.migrationRegisterInputCapture,
        MIGRATION_OVERRIDE_CAPTURE_PATH: fixture.migrationOverrideCapture,
        MIGRATION_NETWORK_CAPTURE_PATH: fixture.migrationNetworkCapture,
        MIGRATION_CAPACITY_CAPTURE_PATH: fixture.migrationCapacityCapture,
        DEPLOY_FAILURE_MODE: deployFailureMode,
        ROLLBACK_MODE: rollbackMode,
        MEMENTOS_CORS_ORIGIN: "https://mementos.hasna.xyz",
        AWS_REGION: "us-east-1",
        CLUSTER: "fixture-cluster",
        SERVICE: "mementos-prod",
        WEB_FAMILY: "mementos-prod",
        WEB_CONTAINER: "mementos",
        MIGRATION_FAMILY: "mementos-prod-migrate",
        MIGRATION_CONTAINER: "mementos-migrate",
        ECR_REPOSITORY: "mementos",
        ECR_URL: "123456789012.dkr.ecr.us-east-1.amazonaws.com/mementos",
        CANDIDATE_SHA: "b".repeat(40),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ...fixture, stdout, stderr, exitCode };
}

async function runVerify(
  healthMode: "healthy" | "readiness-failure",
  rollbackMode: "restore" | "drift" = "restore",
) {
  const fixture = makeFixture(["mementos-deploy"]);
  writeFileSync(fixture.state, "new\n");
  const proc = Bun.spawn(
    ["bash", resolve(root, "scripts/production-deploy.sh"), "verify"],
    {
      cwd: root,
      env: {
        PATH: `${fixture.dir}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? fixture.dir,
        TRACE_PATH: fixture.trace,
        STATE_PATH: fixture.state,
        FIXTURE_DIR: fixture.dir,
        GITHUB_OUTPUT: fixture.githubOutput,
        HEALTH_MODE: healthMode,
        ROLLBACK_MODE: rollbackMode,
        AWS_REGION: "us-east-1",
        CLUSTER: "fixture-cluster",
        SERVICE: "mementos-prod",
        WEB_FAMILY: "mementos-prod",
        WEB_CONTAINER: "mementos",
        MIGRATION_FAMILY: "mementos-prod-migrate",
        MIGRATION_CONTAINER: "mementos-migrate",
        APP_BASE_URL: "https://mementos.example.invalid",
        PREVIOUS_TASK_DEFINITION:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
        DEPLOYED_TASK_DEFINITION:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ...fixture, stdout, stderr, exitCode };
}

afterEach(() => {
  while (fixtureDirs.length > 0) {
    rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
  }
});

describe("production deploy orchestration", () => {
  test("a foreign live command stops before ECR lookup or any ECS mutation", async () => {
    // The preflight command gate refuses any stable baseline the deploy lane
    // does not own. A container that runs mementos-mcp (or any other command)
    // is not the deploy-lane web service and must never be clobbered.
    const result = await runDeploy(["mementos-mcp"]);
    const trace = readFileSync(result.trace, "utf8");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("automated deploy prerequisite unmet");
    expect(trace).not.toContain("ecr describe-images");
    expect(trace).not.toContain("ecs register-task-definition");
    expect(trace).not.toContain("ecs update-service");
  });

  test("a legacy mementos-serve baseline bootstraps the lane into deploy-lane ownership", async () => {
    // Regression (O15-05020): preflight demanded the live stable task
    // definition run EXACTLY ["mementos-deploy"] — the marker this lane
    // itself registers on every new revision. The pre-lane baseline (deployed
    // by the nested-lane/Terraform era) runs ["mementos-serve"], so the very
    // first deploy could never pass preflight: the gate demanded the state
    // only the deploy could create. A serve baseline is the one-time
    // bootstrappable predecessor — the deploy accepts it, registers the new
    // revision with the ["mementos-deploy"] marker, and transitions the
    // service into deploy-lane ownership.
    const result = await runDeploy(["mementos-serve"]);
    const trace = readFileSync(result.trace, "utf8");
    const payload = JSON.parse(
      readFileSync(result.registerInputCapture, "utf8"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("automated deploy prerequisite unmet");
    expect(trace).toContain("ecr describe-images");
    expect(trace).toContain("ecs register-task-definition");
    expect(trace).toContain("ecs update-service");
    expect(trace).toContain("ecs wait services-stable");
    expect(payload.containerDefinitions[0].command).toEqual([
      "mementos-deploy",
    ]);
  });

  test("a null-command live baseline (no command override) bootstraps the lane", async () => {
    // Regression (O15-05020, review cycle 1): the LIVE task definition
    // carries no command at all (measured 2026-08-29: mementos-prod:29
    // command=null). A null/absent command runs the image's default CMD
    // (["mementos-serve"]), and preflight reads it as []. The first deploy
    // must accept that exact shape, not only the literal
    // ["mementos-serve"] form.
    const result = await runDeploy([]);
    const trace = readFileSync(result.trace, "utf8");
    const payload = JSON.parse(
      readFileSync(result.registerInputCapture, "utf8"),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("automated deploy prerequisite unmet");
    expect(trace).toContain("ecs register-task-definition");
    expect(trace).toContain("ecs update-service");
    expect(payload.containerDefinitions[0].command).toEqual([
      "mementos-deploy",
    ]);
  });

  test("a satisfied prerequisite preserves registration, rollout, and digest readback", async () => {
    const result = await runDeploy(["mementos-deploy"]);
    const trace = readFileSync(result.trace, "utf8");
    const outputs = readFileSync(result.githubOutput, "utf8");

    expect(result.exitCode).toBe(0);
    expect(trace).toContain("ecr describe-images");
    expect(trace).toContain("ecs register-task-definition");
    expect(trace).toContain("ecs update-service");
    expect(trace).toContain("ecs wait services-stable");
    expect(trace).toContain("ecs describe-tasks");
    expect(outputs).toContain(`candidate_digest=${digest}`);
    expect(outputs).toContain(
      `candidate_image=123456789012.dkr.ecr.us-east-1.amazonaws.com/mementos@${digest}`,
    );
    expect(outputs).toContain(
      "deployed_task_definition=arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
    );
  });

  test("migration inherits the service network and capacity strategy and emits exact-image receipts before service update", async () => {
    const result = await runDeploy(["mementos-deploy"]);
    const trace = readFileSync(result.trace, "utf8");
    const outputs = readFileSync(result.githubOutput, "utf8");
    const migrationRegistration = JSON.parse(
      readFileSync(result.migrationRegisterInputCapture, "utf8"),
    );
    const overrides = JSON.parse(
      readFileSync(result.migrationOverrideCapture, "utf8"),
    );
    const network = JSON.parse(
      readFileSync(result.migrationNetworkCapture, "utf8"),
    );
    const capacity = JSON.parse(
      readFileSync(result.migrationCapacityCapture, "utf8"),
    );
    const runTask = trace.indexOf("ecs run-task");
    const waitStopped = trace.indexOf("ecs wait tasks-stopped");
    const serviceUpdate = trace.indexOf(
      "ecs update-service --cluster fixture-cluster --service mementos-prod --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
    );

    expect(result.exitCode).toBe(0);
    expect(migrationRegistration.family).toBe("mementos-prod-migrate");
    expect(migrationRegistration.containerDefinitions[0]).toMatchObject({
      name: "mementos-migrate",
      image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/mementos@${digest}`,
      command: ["mementos", "storage", "migrate"],
      secrets: [
        {
          name: "MIGRATION_DATABASE_URL",
          valueFrom:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:migration-owner",
        },
      ],
    });
    expect(overrides).toEqual({
      containerOverrides: [
        {
          name: "mementos-migrate",
          command: ["mementos", "storage", "migrate"],
        },
      ],
    });
    expect(network).toEqual({
      awsvpcConfiguration: {
        subnets: ["subnet-0123456789abcdef0"],
        securityGroups: ["sg-0123456789abcdef0"],
        assignPublicIp: "ENABLED",
      },
    });
    expect(capacity).toEqual([
      { capacityProvider: "FARGATE", weight: 1, base: 0 },
    ]);
    expect(trace).toContain(
      "ecs run-task --cluster fixture-cluster --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
    );
    expect(runTask).toBeGreaterThanOrEqual(0);
    expect(waitStopped).toBeGreaterThan(runTask);
    expect(serviceUpdate).toBeGreaterThan(waitStopped);
    expect(outputs).toContain(
      "migration_task_definition=arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod-migrate:9",
    );
    expect(outputs).toContain(
      "migration_task=arn:aws:ecs:us-east-1:123456789012:task/fixture-cluster/migration-fixture",
    );
    expect(outputs).toContain("migration_exit_code=0");
  });

  for (const failureMode of [
    "migration-launch-fail",
    "migration-wait-fail",
    "migration-exit-fail",
    "migration-wrong-task-definition",
    "migration-wrong-digest",
    "migration-missing-digest",
  ] as const) {
    test(`migration failure ${failureMode} refuses before service update`, async () => {
      const result = await runDeploy(
        ["mementos-deploy"],
        "complete",
        [],
        failureMode,
      );
      const trace = readFileSync(result.trace, "utf8");

      expect(result.exitCode).not.toBe(0);
      expect(trace).toContain("ecs run-task");
      expect(trace).not.toContain("ecs update-service");
      expect(existsSync(result.state)).toBe(false);
    });
  }

  for (const failureMode of ["missing-network", "missing-capacity"] as const) {
    test(`migration configuration ${failureMode} refuses before task launch or service update`, async () => {
      const result = await runDeploy(
        ["mementos-deploy"],
        "complete",
        [],
        failureMode,
      );
      const trace = readFileSync(result.trace, "utf8");

      expect(result.exitCode).not.toBe(0);
      expect(trace).not.toContain("ecs run-task");
      expect(trace).not.toContain("ecs update-service");
      expect(existsSync(result.state)).toBe(false);
      expect(result.stderr).toMatch(
        /network configuration|capacity-provider strategy/,
      );
    });
  }

  for (const failureMode of [
    "update-fail",
    "wait-fail",
    "list-fail",
    "malformed-list",
    "detail-fail",
  ] as const) {
    test(`post-update failure ${failureMode} restores the prior task definition in the same deploy step`, async () => {
      const result = await runDeploy(
        ["mementos-deploy"],
        "complete",
        [],
        failureMode,
      );
      const trace = readFileSync(result.trace, "utf8");
      const outputs = readFileSync(result.githubOutput, "utf8");
      const candidateUpdate = trace.indexOf(
        "ecs update-service --cluster fixture-cluster --service mementos-prod --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
      );
      const rollbackUpdate = trace.indexOf(
        "ecs update-service --cluster fixture-cluster --service mementos-prod --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
      );

      expect(result.exitCode).toBe(1);
      expect(candidateUpdate).toBeGreaterThanOrEqual(0);
      expect(rollbackUpdate).toBeGreaterThan(candidateUpdate);
      expect(readFileSync(result.state, "utf8").trim()).toBe("previous");
      expect(outputs).toContain(
        "rolled_back_task_definition=arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
      );
      expect(result.stderr).toContain("rollback restored one stable PRIMARY");
    });
  }

  test("a post-update failure that cannot prove rollback reports manual recovery and never claims restoration", async () => {
    const result = await runDeploy(
      ["mementos-deploy"],
      "complete",
      [],
      "wait-fail",
      "drift",
    );

    expect(result.exitCode).toBe(1);
    expect(readFileSync(result.state, "utf8").trim()).toBe("drift");
    expect(result.stderr).toContain(
      "candidate deployment failed and rollback could not be proven",
    );
    expect(result.stderr).toContain("manual recovery required");
    expect(result.stderr).not.toContain("candidate deployment rejected:");
  });

  test("a waiter-valid readback that lags once is reread until the strict deployment proof completes", async () => {
    const result = await runDeploy(["mementos-deploy"], "lag-then-complete");

    expect(result.exitCode).toBe(0);
    expect(readFileSync(result.readbackCount, "utf8").trim()).toBe("2");
    expect(result.stderr).not.toContain("deployment readback did not prove");
  });

  test("a permanently bad readback remains bounded, evidence-rich, and fail closed", async () => {
    const result = await runDeploy(["mementos-deploy"], "permanently-bad");
    const readbackCount = Number(
      readFileSync(result.readbackCount, "utf8").trim(),
    );
    const trace = readFileSync(result.trace, "utf8");

    expect(result.exitCode).toBe(1);
    expect(readbackCount).toBeGreaterThan(1);
    expect(readbackCount).toBeLessThanOrEqual(6);
    expect(trace).not.toContain("ecs list-tasks");
    expect(readFileSync(result.state, "utf8").trim()).toBe("previous");
    expect(trace).toContain(
      "ecs update-service --cluster fixture-cluster --service mementos-prod --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
    );
    expect(result.stderr).toContain("primary_count=1");
    expect(result.stderr).toContain("primary_rollout_state=IN_PROGRESS");
    expect(result.stderr).toContain("desired/running/pending=1/1/0");
    expect(result.stderr).toContain("rollback restored one stable PRIMARY");
  });

  test("successful endpoint verification preserves the deployed revision without rollback", async () => {
    const result = await runVerify("healthy");
    const trace = readFileSync(result.trace, "utf8");
    const outputs = readFileSync(result.githubOutput, "utf8");

    expect(result.exitCode).toBe(0);
    expect(trace.match(/^curl /gm)).toHaveLength(4);
    expect(trace).not.toContain("ecs update-service");
    expect(trace).not.toContain("ecs wait services-stable");
    expect(readFileSync(result.state, "utf8").trim()).toBe("new");
    expect(outputs).toContain(
      "verified_task_definition=arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:17",
    );
  });

  test("failed readiness restores and proves the exact previous revision before final failure", async () => {
    const result = await runVerify("readiness-failure");
    const trace = readFileSync(result.trace, "utf8");
    const outputs = readFileSync(result.githubOutput, "utf8");
    const readinessProbe = trace.indexOf(
      "curl -sS -o /dev/null -w %{http_code} -m 15 https://mementos.example.invalid/ready",
    );
    const restore = trace.indexOf(
      "ecs update-service --cluster fixture-cluster --service mementos-prod --task-definition arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16 --force-new-deployment",
    );
    const stable = trace.indexOf("ecs wait services-stable", restore);
    const readback = trace.indexOf("ecs describe-services", stable);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("GET /ready -> 503 (curl_rc=0)");
    expect(readinessProbe).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(readinessProbe);
    expect(stable).toBeGreaterThan(restore);
    expect(readback).toBeGreaterThan(stable);
    expect(readFileSync(result.state, "utf8").trim()).toBe("previous");
    expect(outputs).toContain(
      "rolled_back_task_definition=arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
    );
    expect(result.stderr).toContain(
      "rollback restored one stable PRIMARY on arn:aws:ecs:us-east-1:123456789012:task-definition/mementos-prod:16",
    );
  });

  test("rollback drift is surfaced and never described as restored", async () => {
    const result = await runVerify("readiness-failure", "drift");

    expect(result.exitCode).toBe(1);
    expect(readFileSync(result.state, "utf8").trim()).toBe("drift");
    expect(result.stderr).toContain(
      "rollback failed: readback did not prove one ACTIVE stable PRIMARY",
    );
    expect(result.stderr).toContain(
      "deployment rejected and rollback could not be proven",
    );
    expect(result.stderr).not.toContain("rollback restored one stable PRIMARY");
  });

  test("deploy injects MEMENTOS_CORS_ORIGIN into the registered task definition when the live definition lacks it", async () => {
    const result = await runDeploy(["mementos-deploy"]);
    const payload = JSON.parse(
      readFileSync(result.registerInputCapture, "utf8"),
    );
    const env = payload.containerDefinitions[0].environment;

    expect(result.exitCode).toBe(0);
    expect(env).toEqual([
      { name: "MEMENTOS_CORS_ORIGIN", value: "https://mementos.hasna.xyz" },
    ]);
  });

  test("deploy does not duplicate MEMENTOS_CORS_ORIGIN when the live definition already carries it", async () => {
    const result = await runDeploy(["mementos-deploy"], "complete", [
      { name: "MEMENTOS_CORS_ORIGIN", value: "https://mementos.hasna.xyz" },
    ]);
    const payload = JSON.parse(
      readFileSync(result.registerInputCapture, "utf8"),
    );
    const env = payload.containerDefinitions[0].environment;

    expect(result.exitCode).toBe(0);
    expect(env).toEqual([
      { name: "MEMENTOS_CORS_ORIGIN", value: "https://mementos.hasna.xyz" },
    ]);
  });
});
