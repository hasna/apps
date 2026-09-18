import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
const workflow = readFileSync(join(root, ".github/workflows/emails-current-server-deploy.yml"), "utf8");
const gate = readFileSync(join(root, "tooling/deploy/emails-current/gate.py"), "utf8");
const deploy = readFileSync(join(root, "tooling/deploy/emails-current/deploy.py"), "utf8");
const proof = readFileSync(join(root, "tooling/deploy/emails-current/public_proof.py"), "utf8");

describe("Emails complete current-server deploy lane", () => {
  test("is manual, exact-main, production-bound, and serialized with overlay reconciliation", () => {
    expect(workflow).toContain("name: emails-current-server-deploy");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+workflow_run:/m);
    expect(workflow).toContain("group: emails-search-production");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("--run \"$RECONCILIATION_RUN\"");
    expect(workflow).toContain("--reconciled-sha256 \"$RECONCILED_SHA256\"");
    expect(workflow.match(/tooling\/deploy\/emails-current\/gate\.py/g)).toHaveLength(2);
    expect(gate).toContain('run.get("path") == ".github/workflows/emails-search-promotion.yml"');
    expect(gate).toContain('run.get("head_sha") == args.source');
    expect(gate).toContain('row.get("path") == ".github/workflows/ci.yml"');
  });

  test("builds and scans amd64 before AWS, then changes only the reconciled image", () => {
    const smoke = workflow.indexOf("Exercise the exact amd64 server image");
    const scan = workflow.indexOf("Enforce vulnerability gate");
    const authority = workflow.indexOf("Assume only the existing Emails producer role");
    const update = workflow.indexOf("Register and deploy an image-only clone");
    expect(smoke).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(smoke);
    expect(authority).toBeGreaterThan(scan);
    expect(update).toBeGreaterThan(authority);
    expect(workflow).toContain("CONTAINER_RUNTIME_PLATFORM: linux/amd64");
    expect(workflow).toContain("git diff --exit-code \"$overlay_source\" \"$GITHUB_SHA\" -- apps/emails/src/server/self-hosted/migrations.ts");
    expect(workflow).not.toMatch(/npm publish|bun publish|ecs run-task|db migrate/i);
    expect(deploy).toContain('rows[0]["image"] = promotion.REPOSITORY + "@" + image_digest');
    expect(deploy).toContain('require(normalized == current_payload, "CANDIDATE_TASK_DRIFT")');
    expect(deploy).toContain('"automaticRollback": False');
  });

  test("pins the canonical base URL and proves one v1 plus provider and reply authority", () => {
    expect(workflow).toContain("PUBLIC_BASE_URL: https://api.hasna.com/emails");
    expect(workflow).not.toContain("https://api.hasna.com/emails/v1");
    expect(proof).toContain('BASE = "https://api.hasna.com/emails"');
    expect(proof).toContain('"/v1/providers/secrets/status"');
    expect(proof).toContain('"/v1/providers/{id}/credentials"');
    expect(proof).toContain('"reply_to_message_id"');
    expect(proof).toContain('not key.startswith("/v1/v1/")');
  });
});
