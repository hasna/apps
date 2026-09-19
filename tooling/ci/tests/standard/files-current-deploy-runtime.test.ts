import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "../../../..");
const anchor = join(root, "tooling/deploy/files-current/assert-service-anchor.sh");
const readiness = join(root, "tooling/deploy/files-current/verify-readiness.sh");
const dataPlane = join(root, "tooling/deploy/files-current/verify-canonical-data-plane.sh");
const migration = join(root, "tooling/deploy/files-current/run-migration.sh");
const restore = join(root, "tooling/deploy/files-current/restore-service-anchor.sh");
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
const task23 = "arn:aws:ecs:us-east-1:789877399345:task-definition/files-prod:23";
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

  test("rollback refuses to overwrite a concurrent newer deployment", async () => {
    const dir = temp();
    const updateLog = join(dir, "update-called");
    executable(join(dir, "aws"), `#!/usr/bin/env bash
if [[ "$*" == *"ecs describe-services"* ]]; then
  printf '{"failures":[],"services":[{"status":"ACTIVE","taskDefinition":"${task23}","deployments":[{"status":"PRIMARY","rolloutState":"COMPLETED","taskDefinition":"${task23}","desiredCount":1,"runningCount":1,"pendingCount":0}]}]}\n'
  exit 0
fi
if [[ "$*" == *"ecs update-service"* ]]; then printf called > "$FAKE_UPDATE_LOG"; exit 0; fi
exit 9
`);
    const rollback = join(dir, "rollback.json");
    const reconciliation = join(dir, "reconciliation.json");
    const result = await run(restore, ["oss-fleet-prod", "files-prod", task22, task21, source, image, "old@sha256:" + "e".repeat(64), rollback, reconciliation], {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_UPDATE_LOG: updateLog,
    });
    expect(result.code).toBe(1);
    expect(existsSync(updateLog)).toBe(false);
    expect(existsSync(rollback)).toBe(false);
    expect(JSON.parse(readFileSync(reconciliation, "utf8"))).toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      reason: "concurrent_service_change_before_rollback",
      candidate: { task_definition: task22 },
      previous: { task_definition: task21 },
      observed: { task_definition: task23 },
      automatic_rollback_performed: false,
    });
  });

  test("rollback replaces only the observed candidate with the captured predecessor", async () => {
    const dir = temp();
    const state = join(dir, "describe-count");
    const updateLog = join(dir, "update-args");
    executable(join(dir, "aws"), `#!/usr/bin/env bash
if [[ "$*" == *"ecs describe-services"* ]]; then
  count=0; [[ -f "$FAKE_STATE" ]] && count="$(cat "$FAKE_STATE")"
  count=$((count + 1)); printf '%s' "$count" > "$FAKE_STATE"
  td="${task22}"; [[ "$count" -gt 1 ]] && td="${task21}"
  printf '{"failures":[],"services":[{"status":"ACTIVE","taskDefinition":"%s","deployments":[{"status":"PRIMARY","rolloutState":"COMPLETED","taskDefinition":"%s","desiredCount":1,"runningCount":1,"pendingCount":0}]}]}\n' "$td" "$td"
  exit 0
fi
if [[ "$*" == *"ecs update-service"* ]]; then printf '%s\n' "$*" > "$FAKE_UPDATE_LOG"; exit 0; fi
if [[ "$*" == *"ecs wait services-stable"* ]]; then exit 0; fi
exit 9
`);
    const rollback = join(dir, "rollback.json");
    const reconciliation = join(dir, "reconciliation.json");
    const previousImage = "old@sha256:" + "e".repeat(64);
    const result = await run(restore, ["oss-fleet-prod", "files-prod", task22, task21, source, image, previousImage, rollback, reconciliation], {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_STATE: state,
      FAKE_UPDATE_LOG: updateLog,
    });
    expect(result.code).toBe(0);
    expect(readFileSync(updateLog, "utf8")).toContain(`--task-definition ${task21}`);
    expect(existsSync(reconciliation)).toBe(false);
    expect(JSON.parse(readFileSync(rollback, "utf8"))).toMatchObject({
      candidate: { task_definition: task22, image },
      restored: { task_definition: task21, image: previousImage },
      automatic_rollback_performed: true,
      cas_anchor_verified: true,
    });
  });

  test("canonical readiness rejects redirects, identityless, stale, and misrouted bodies", async () => {
    const dir = temp();
    const argsLog = join(dir, "curl-args");
    executable(join(dir, "curl"), `#!/usr/bin/env bash
printf '%s\n' "$*" > "$FAKE_CURL_ARGS"
case "$FAKE_CURL_MODE" in
  redirect) printf '{"status":"ok","storage":"postgres","version":"0.5.0","deployment_environment":"production","source_commit":"${source}","image_digest":"${digest}"}\n302' ;;
  wrong) printf '{"status":"ok","storage":"sqlite","version":"0.5.0","deployment_environment":"production","source_commit":"${source}","image_digest":"${digest}"}\n200' ;;
  identityless) printf '{"status":"ok","storage":"postgres","version":"0.5.0"}\n200' ;;
  stale) printf '{"status":"ok","storage":"postgres","version":"0.5.0","deployment_environment":"production","source_commit":"${"d".repeat(40)}","image_digest":"${digest}"}\n200' ;;
  misrouted) printf '{"status":"ok","storage":"postgres","version":"0.5.0","deployment_environment":"production","source_commit":"${source}","image_digest":"sha256:${"c".repeat(64)}"}\n200' ;;
  multi) printf '{}\n{}\n200' ;;
  *) printf '{"status":"ok","storage":"postgres","version":"0.5.0","deployment_environment":"production","source_commit":"${source}","image_digest":"${digest}"}\n200' ;;
esac
`);
    const base = { PATH: `${dir}:${process.env.PATH}`, FAKE_CURL_ARGS: argsLog };
    const args = ["https://api.hasna.com/files/ready", "0.5.0", source, image, join(dir, "receipt.json")];
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "ok" })).code).toBe(0);
    expect(readFileSync(argsLog, "utf8")).toContain("--max-redirs 0");
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "redirect" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "wrong" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "identityless" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "stale" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "misrouted" })).code).toBe(1);
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "multi" })).code).toBe(1);
  });

  test("canonical data-plane proof requires one /v1 server plus anonymous and authenticated manifest receipts", async () => {
    const dir = temp();
    const argsLog = join(dir, "curl-args");
    const keyFile = join(dir, "files-api-key");
    writeFileSync(keyFile, "fixture-files-key");
    chmodSync(keyFile, 0o600);
    executable(join(dir, "curl"), `#!/usr/bin/env bash
printf '<%s>\n' "$@" >> "$FAKE_CURL_ARGS"
if [[ "$*" == *"/openapi.json"* ]]; then
  case "$FAKE_MODE" in
    double) printf '{"openapi":"3.0.3","servers":[{"url":"/v1"}],"paths":{"/v1/knowledge/manifest":{"get":{}}}}\n200' ;;
    missing) printf '{"openapi":"3.0.3","servers":[{"url":"/v1"}],"paths":{}}\n200' ;;
    redirect) printf '{}\n302' ;;
    *) printf '{"openapi":"3.0.3","servers":[{"url":"/v1"}],"paths":{"/knowledge/manifest":{"get":{}}}}\n200' ;;
  esac
  exit 0
fi
header_file=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--header" ]]; then header_file="\${argument#@}"; fi
  previous="$argument"
done
if [[ -z "$header_file" ]]; then
  [[ "$FAKE_MODE" == "route404" ]] && printf '{"error":"not found"}\n404' || printf '{"error":"missing credential"}\n401'
  exit 0
fi
grep -qx 'x-api-key: fixture-files-key' "$header_file" || { printf '{"error":"bad fixture header"}\n401'; exit 0; }
case "$FAKE_MODE" in
  auth401) printf '{"error":"rejected"}\n401' ;;
  authRedirect) printf '{}\n302' ;;
  authMalformed) printf '{}\n200' ;;
  *) printf '{"filter_contract":"files.knowledge.manifest.v1","cursor_contract":"files.knowledge.manifest.change.v1","manifest_id":"manifest-fixture","generated_at":"2026-09-19T00:00:00.000Z","format":"json","filters":{},"item_count":0,"has_more":false,"complete":true,"delta":false,"high_watermark":"0","delta_cursor":"signed-fixture","tombstone_count":0,"items":[]}\n200' ;;
esac
`);
    const receipt = join(dir, "data-plane.json");
    const base = { PATH: `${dir}:${process.env.PATH}`, FAKE_CURL_ARGS: argsLog, FAKE_MODE: "ok" };
    const args = ["https://api.hasna.com/files", keyFile, "hasna/oss/files/api-key", receipt];
    const good = await run(dataPlane, args, base);
    expect(good.code).toBe(0);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toMatchObject({
      schema: "hasna.files.canonical_data_plane.v1",
      base_url: "https://api.hasna.com/files",
      openapi: { server: "/v1", route: "/knowledge/manifest", double_v1_paths: 0 },
      anonymous_boundary: { http_status: 401, credentials_sent: false, redirects_followed: false },
      authenticated_manifest: {
        http_status: 200,
        credentials_sent: true,
        credential_ref: "hasna/oss/files/api-key",
        header: "x-api-key",
        redirects_followed: false,
        contract: { filter_contract: "files.knowledge.manifest.v1", item_count: 0, has_more: false, complete: true },
      },
      single_v1: true,
    });
    const calls = readFileSync(argsLog, "utf8");
    expect(calls).toContain("https://api.hasna.com/files/openapi.json");
    expect(calls).toContain("https://api.hasna.com/files/v1/knowledge/manifest?limit=1");
    expect(calls).toContain("--header");
    expect(calls).not.toContain("fixture-files-key");
    expect(calls).not.toContain("authorization");
    for (const mode of ["double", "missing", "redirect", "route404", "auth401", "authRedirect", "authMalformed"]) {
      const modeArgs = ["https://api.hasna.com/files", keyFile, "hasna/oss/files/api-key", join(dir, `${mode}.json`)];
      expect((await run(dataPlane, modeArgs, { ...base, FAKE_MODE: mode })).code).toBe(1);
    }
    expect((await run(dataPlane, ["https://api.hasna.com/files", keyFile, "wrong/ref", join(dir, "wrong-ref.json")], base)).code).toBe(2);
    chmodSync(keyFile, 0o644);
    expect((await run(dataPlane, args, base)).code).toBe(2);
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
