import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "../../../..");
const anchor = join(root, "tooling/deploy/files-current/assert-service-anchor.sh");
const readiness = join(root, "tooling/deploy/files-current/verify-readiness.sh");
const migration = join(root, "tooling/deploy/files-current/run-migration.sh");
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function temp(): string { const dir = mkdtempSync(join(tmpdir(), "files-current-deploy-")); scratch.push(dir); return dir; }
function executable(path: string, body: string): void { writeFileSync(path, body); chmodSync(path, 0o755); }
async function run(script: string, args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bash", script, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

const task21 = "arn:aws:ecs:us-east-1:789877399345:task-definition/files-prod:21";
const task22 = "arn:aws:ecs:us-east-1:789877399345:task-definition/files-prod:22";
const migrate20 = "arn:aws:ecs:us-east-1:789877399345:task-definition/files-prod-migrate:20";
const taskArn = "arn:aws:ecs:us-east-1:789877399345:task/oss-fleet-prod/0123456789abcdef";
const source = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const image = `789877399345.dkr.ecr.us-east-1.amazonaws.com/open-files@${digest}`;

describe("Files deployment runtime guards", () => {
  test("service anchor accepts the captured revision and rejects a concurrent race", async () => {
    const dir = temp();
    executable(join(dir, "aws"), `#!/usr/bin/env bash
if [[ "$*" == *"ecs describe-services"* ]]; then
  td="${task21}"; [[ "$FAKE_DRIFT" == 1 ]] && td="${task22}"
  printf '{"failures":[],"services":[{"status":"ACTIVE","taskDefinition":"%s","deployments":[{"status":"PRIMARY","taskDefinition":"%s"}]}]}\\n' "$td" "$td"
  exit 0
fi
exit 9
`);
    const env = { PATH: `${dir}:${process.env.PATH}`, FAKE_DRIFT: "0" };
    expect((await run(anchor, ["oss-fleet-prod", "files-prod", task21], env)).code).toBe(0);
    const raced = await run(anchor, ["oss-fleet-prod", "files-prod", task21], { ...env, FAKE_DRIFT: "1" });
    expect(raced.code).toBe(1);
    expect(raced.stderr).toContain("service anchor changed before mutation");
  });

  test("canonical readiness rejects redirects and wrong JSON bodies", async () => {
    const dir = temp();
    const argsLog = join(dir, "curl-args");
    executable(join(dir, "curl"), `#!/usr/bin/env bash
printf '%s\\n' "$*" > "$FAKE_CURL_ARGS"
case "$FAKE_CURL_MODE" in
  redirect) printf '{"status":"ok","storage":"postgres","version":"0.5.0"}\\n302' ;;
  wrong) printf '{"status":"ok","storage":"sqlite","version":"0.5.0"}\\n200' ;;
  identity) printf '{"status":"ok","storage":"postgres","version":"0.5.0","source_sha":"wrong"}\\n200' ;;
  multi) printf '{}\\n{}\\n200' ;;
  *) printf '{"status":"ok","storage":"postgres","version":"0.5.0"}\\n200' ;;
esac
`);
    const base = { PATH: `${dir}:${process.env.PATH}`, FAKE_CURL_ARGS: argsLog };
    const args = ["https://api.hasna.com/files/ready", "0.5.0", source, image, join(dir, "receipt.json")];
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "ok" })).code).toBe(0);
    expect(readFileSync(argsLog, "utf8")).toContain("--max-redirs 0");
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "redirect" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "wrong" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "identity" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "multi" })).code).toBe(1);
  });

  test("a waiter failure retains launch identity and best-effort partial state", async () => {
    const dir = temp();
    executable(join(dir, "aws"), `#!/usr/bin/env bash
if [[ "$*" == *"ecs run-task"* ]]; then
  printf '{"failures":[],"tasks":[{"taskArn":"${taskArn}","taskDefinitionArn":"${migrate20}"}]}\\n'
  exit 0
fi
if [[ "$*" == *"ecs wait tasks-stopped"* ]]; then exit 255; fi
if [[ "$*" == *"ecs describe-tasks"* ]]; then
  printf '{"tasks":[{"taskArn":"${taskArn}","taskDefinitionArn":"${migrate20}","lastStatus":"RUNNING","containers":[{"name":"files-migrate","image":"${image}","imageDigest":"${digest}","lastStatus":"RUNNING"}]}]}\\n'
  exit 0
fi
exit 9
`);
    const launch = join(dir, "launch.json");
    const observed = join(dir, "observed.json");
    const output = join(dir, "github-output");
    const result = await run(migration, ["oss-fleet-prod", migrate20, "files-migrate", "subnet-a", "sg-a", "ENABLED", image, source, launch, observed], {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ID: "12345",
    });
    expect(result.code).not.toBe(0);
    expect(JSON.parse(readFileSync(launch, "utf8"))).toMatchObject({ task_arn: taskArn, requested_task_definition: migrate20, candidate_image: image });
    expect(JSON.parse(readFileSync(observed, "utf8"))).toMatchObject({ describe_available: true, observed: { task_definition: migrate20, last_status: "RUNNING", container: { image, image_digest: digest, last_status: "RUNNING" } } });
    const emitted = readFileSync(output, "utf8");
    expect(emitted).toContain(`task=${taskArn}`);
    expect(emitted).toContain(`task_definition=${migrate20}`);
    expect(emitted).toContain(`image=${image}`);
  });
});
