import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "../../../..");
const anchor = join(root, "tooling/deploy/domains/assert-service-anchor.sh");
const readiness = join(root, "tooling/deploy/domains/verify-readiness.sh");
const dataPlane = join(root, "tooling/deploy/domains/verify-canonical-data-plane.sh");
const migration = join(root, "tooling/deploy/domains/run-migration.sh");
const restore = join(root, "tooling/deploy/domains/restore-service-anchor.sh");
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function temp(): string { const dir = mkdtempSync(join(tmpdir(), "domains-deploy-")); scratch.push(dir); return dir; }
function executable(path: string, body: string): void { writeFileSync(path, body); chmodSync(path, 0o755); }
async function run(script: string, args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bash", script, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

const task21 = "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-web:21";
const task22 = "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-web:22";
const task23 = "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-web:23";
const migrate20 = "arn:aws:ecs:us-east-1:123456789012:task-definition/fixture-migrate:20";
const taskArn = "arn:aws:ecs:us-east-1:123456789012:task/fixture-cluster/0123456789abcdef";
const source = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const image = `123456789012.dkr.ecr.us-east-1.amazonaws.com/fixture-repository@${digest}`;

describe("Domains manifest secret projection", () => {
  test("requires Cloudflare provider authority in the manifest and injects it into the candidate", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "deploy-domains.yml"), "utf8");
    expect(workflow).toContain('has("CLOUDFLARE_API_TOKEN")');
    expect(workflow).toContain("MANIFEST_WEB_SECRETS");
    expect(workflow).toContain("required_secrets");
    expect(workflow).toContain("valueFrom:.value");
    for (const name of ["CLOUDFLARE_ACCOUNT_ID", "DOMAINS_REGISTRANT_SOURCE_DOMAIN", "DOMAINS_PROVISIONING_INTERVAL_MS", "DOMAINS_PROVISIONING_MAX_ATTEMPTS"]) {
      expect(workflow).toContain(`has(\"${name}\")`);
    }
    expect(workflow).toContain("MANIFEST_WEB_ENVIRONMENT");
    expect(workflow).toContain("required_environment");
    expect(workflow).toContain("value:.value");
  });
});

describe("Domains deployment runtime guards", () => {
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
    expect((await run(anchor, ["fixture-cluster", "fixture-service", task21], env)).code).toBe(0);
    const raced = await run(anchor, ["fixture-cluster", "fixture-service", task21], { ...env, FAKE_DRIFT: "1" });
    expect(raced.code).toBe(1);
    expect(raced.stderr).toContain("service anchor changed before mutation");
  });

  test("rollback refuses a newer deployment and emits RECONCILIATION_REQUIRED", async () => {
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
    const result = await run(restore, ["fixture-cluster", "fixture-service", task22, task21, source, image, "old@sha256:" + "e".repeat(64), rollback, reconciliation], {
      PATH: `${dir}:${process.env.PATH}`, FAKE_UPDATE_LOG: updateLog,
    });
    expect(result.code).toBe(1);
    expect(existsSync(updateLog)).toBe(false);
    expect(existsSync(rollback)).toBe(false);
    expect(JSON.parse(readFileSync(reconciliation, "utf8"))).toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      reason: "concurrent_service_change_before_rollback",
      automatic_rollback_performed: false,
      candidate: { task_definition: task22 },
      observed: { task_definition: task23 },
    });
  });

  test("rollback replaces only the exact observed candidate with its captured predecessor", async () => {
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
    const result = await run(restore, ["fixture-cluster", "fixture-service", task22, task21, source, image, previousImage, rollback, reconciliation], {
      PATH: `${dir}:${process.env.PATH}`, FAKE_STATE: state, FAKE_UPDATE_LOG: updateLog,
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

  test("canonical readiness requires one bounded ready object with no pending migrations", async () => {
    const dir = temp();
    const argsLog = join(dir, "curl-args");
    executable(join(dir, "curl"), `#!/usr/bin/env bash
printf '%s\n' "$*" > "$FAKE_CURL_ARGS"
case "$FAKE_CURL_MODE" in
  redirect) printf '{"status":"ok","version":"0.2.0","pendingMigrations":[]}\n302' ;;
  pending) printf '{"status":"not_ready","version":"0.2.0","pendingMigrations":["domains_0017"]}\n503' ;;
  wrong) printf '{"status":"ok","version":"0.1.0","pendingMigrations":[]}\n200' ;;
  multi) printf '{}\n{}\n200' ;;
  *) printf '{"status":"ok","version":"0.2.0","pendingMigrations":[]}\n200' ;;
esac
`);
    const base = { PATH: `${dir}:${process.env.PATH}`, FAKE_CURL_ARGS: argsLog };
    const args = ["https://api.hasna.com/domains/ready", "0.2.0", join(dir, "receipt.json")];
    expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: "ok" })).code).toBe(0);
    expect(readFileSync(argsLog, "utf8")).toContain("--max-redirs 0");
    for (const mode of ["redirect", "pending", "wrong", "multi"]) {
      expect((await run(readiness, args, { ...base, FAKE_CURL_MODE: mode })).code).toBe(1);
    }
  });

  test("canonical acceptance proves OpenAPI, anonymous auth refusal and authenticated provisioning read without side effects", async () => {
    const dir = temp();
    const argsLog = join(dir, "curl-args");
    const keyFile = join(dir, "domains-api-key");
    writeFileSync(keyFile, "fixture-domains-key");
    chmodSync(keyFile, 0o600);
    executable(join(dir, "curl"), `#!/usr/bin/env bash
printf '<%s>\n' "$@" >> "$FAKE_CURL_ARGS"
if [[ "$*" == *"/openapi.json"* ]]; then
  case "$FAKE_MODE" in
    double) printf '{"openapi":"3.1.0","paths":{"/v1/v1/provisioning":{"post":{}},"/v1/provisioning/{id}":{"get":{}},"/v1/domains":{"get":{}}}}\n200' ;;
    missing) printf '{"openapi":"3.1.0","paths":{}}\n200' ;;
    redirect) printf '{}\n302' ;;
    *) printf '{"openapi":"3.1.0","paths":{"/v1/provisioning":{"post":{}},"/v1/provisioning/{id}":{"get":{}},"/v1/domains":{"get":{}}}}\n200' ;;
  esac
  exit 0
fi
header_file=""; previous=""
for argument in "$@"; do
  if [[ "$previous" == "--header" ]]; then header_file="\${argument#@}"; fi
  previous="$argument"
done
if [[ -z "$header_file" ]]; then
  [[ "$FAKE_MODE" == "route404" ]] && printf '{"error":"not found"}\n404' || printf '{"error":"missing credential"}\n401'
  exit 0
fi
grep -qx 'x-api-key: fixture-domains-key' "$header_file" || { printf '{"error":"bad fixture header"}\n401'; exit 0; }
case "$FAKE_MODE" in
  auth401) printf '{"error":"rejected"}\n401' ;;
  authRedirect) printf '{}\n302' ;;
  authMalformed) printf '{}\n404' ;;
  *) printf '{"error":"provisioning job not found"}\n404' ;;
esac
`);
    const receipt = join(dir, "data-plane.json");
    const base = { PATH: `${dir}:${process.env.PATH}`, FAKE_CURL_ARGS: argsLog, FAKE_MODE: "ok" };
    const args = ["https://api.hasna.com/domains", keyFile, "fixture/domains/client-key", receipt];
    expect((await run(dataPlane, args, base)).code).toBe(0);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toMatchObject({
      schema: "hasna.domains.canonical_data_plane.v1",
      base_url: "https://api.hasna.com/domains",
      openapi: { provisioning_route: "/v1/provisioning/{id}", double_v1_paths: 0 },
      anonymous_boundary: { http_status: 401, credentials_sent: false, redirects_followed: false },
      authenticated_provisioning_read: { http_status: 404, credentials_sent: true, credential_ref: "fixture/domains/client-key", header: "x-api-key" },
      single_v1: true,
      side_effects: false,
    });
    const calls = readFileSync(argsLog, "utf8");
    expect(calls).toContain("https://api.hasna.com/domains/openapi.json");
    expect(calls).toContain("https://api.hasna.com/domains/v1/provisioning/00000000-0000-4000-8000-000000000000");
    expect(calls).not.toContain("fixture-domains-key");
    for (const mode of ["double", "missing", "redirect", "route404", "auth401", "authRedirect", "authMalformed"]) {
      expect((await run(dataPlane, ["https://api.hasna.com/domains", keyFile, "fixture/domains/client-key", join(dir, `${mode}.json`)], { ...base, FAKE_MODE: mode })).code).toBe(1);
    }
    chmodSync(keyFile, 0o644);
    expect((await run(dataPlane, args, base)).code).toBe(2);
  });

  test("a waiter failure retains migration launch identity and partial observed state", async () => {
    const dir = temp();
    executable(join(dir, "aws"), `#!/usr/bin/env bash
if [[ "$*" == *"ecs run-task"* ]]; then printf '{"failures":[],"tasks":[{"taskArn":"${taskArn}","taskDefinitionArn":"${migrate20}"}]}\\n'; exit 0; fi
if [[ "$*" == *"ecs wait tasks-stopped"* ]]; then exit 255; fi
if [[ "$*" == *"ecs describe-tasks"* ]]; then printf '{"tasks":[{"taskArn":"${taskArn}","taskDefinitionArn":"${migrate20}","lastStatus":"RUNNING","containers":[{"name":"fixture-migrate-container","image":"${image}","imageDigest":"${digest}","lastStatus":"RUNNING"}]}]}\\n'; exit 0; fi
exit 9
`);
    const launch = join(dir, "launch.json");
    const observed = join(dir, "observed.json");
    const output = join(dir, "github-output");
    const result = await run(migration, ["fixture-cluster", migrate20, "fixture-migrate-container", "subnet-a", "sg-a", "ENABLED", image, source, launch, observed], {
      PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_RUN_ID: "12345",
    });
    expect(result.code).not.toBe(0);
    expect(JSON.parse(readFileSync(launch, "utf8"))).toMatchObject({ task_arn: taskArn, requested_task_definition: migrate20, candidate_image: image });
    expect(JSON.parse(readFileSync(observed, "utf8"))).toMatchObject({ describe_available: true, observed: { task_definition: migrate20, last_status: "RUNNING", container: { image, image_digest: digest } } });
    expect(readFileSync(output, "utf8")).toContain(`task=${taskArn}`);
  });
});
