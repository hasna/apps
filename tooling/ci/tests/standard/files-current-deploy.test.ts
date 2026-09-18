import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
const workflow = readFileSync(join(root, ".github/workflows/files-current-server-deploy.yml"), "utf8");
const rollout = readFileSync(join(root, "tooling/deploy/files-current/verify-ecs-rollout.sh"), "utf8");

describe("Files current-server deployment lane", () => {
  test("is manual, exact-current-main, and CI-bound", () => {
    expect(workflow).toContain("name: files-current-server-deploy");
    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+workflow_run:/m);
    expect(workflow).toContain("refs/remotes/origin/main");
    expect(workflow).toContain("head_sha=${source_sha}");
    expect(workflow).toContain('conclusion == "success"');
    expect(workflow).toContain('[[ "${GATED_SHA}" == "${main_tip}" ]]');
  });

  test("builds and scans the exact ARM64 Files server before AWS authority", () => {
    const build = workflow.indexOf("Build native ARM64 image locally");
    const scan = workflow.indexOf("Enforce local vulnerability gate");
    const authority = workflow.indexOf("Configure AWS credentials with GitHub OIDC");
    expect(build).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(build);
    expect(authority).toBeGreaterThan(scan);
    expect(workflow).toContain("--platform linux/arm64");
    expect(workflow).toContain("--target runner");
    expect(workflow).toContain("dist/server/index.js --version");
    expect(workflow).toContain("role/files-prod-gha-deploy");
    expect(workflow).not.toMatch(/npm publish|bun publish/);
  });

  test("uses only the Files manifest targets, digest pins both tasks, and proves readiness", () => {
    expect(workflow).toContain("DEPLOY_MANIFEST: /hasna/deploy/files");
    expect(workflow).toContain("EXPECTED_SERVICE: files-prod");
    expect(workflow).toContain("EXPECTED_ECR_REPOSITORY: open-files");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: files-prod-migrate");
    expect(workflow).toContain('digest_image=%s@%s');
    expect(workflow).toContain('deploymentCircuitBreaker={enable=true,rollback=false}');
    expect(workflow).toContain('ready_url="${HEALTH_URL%/health}/ready"');
    expect(workflow).toContain('https://api.hasna.com/files/ready');
    expect(workflow).toContain("hasna.files.production_deploy.v1");
    expect(rollout).toContain('LIVE_TD" != "$EXPECTED_TASK_DEF');
  });
});
