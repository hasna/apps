import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(
  join(import.meta.dir, "..", "..", "..", "..", ".github", "workflows", "deploy-shortlinks.yml"),
  "utf8",
);

describe("Shortlinks production deployment workflow", () => {
  test("binds the exact public workflow authority to CI-passed main and production", () => {
    expect(workflow).toContain("name: deploy-shortlinks");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [ci]");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("gate (successful ci for the exact main commit)");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain('DEPLOY_PATH_SCOPE: "apps/shortlinks/**"');
    expect(workflow).not.toMatch(/^\s+push:/m);
  });

  test("pins the Shortlinks manifest, role, families, service, and amd64 runtime", () => {
    expect(workflow).toContain("DEPLOY_MANIFEST: /hasna/deploy/shortlinks");
    expect(workflow).toContain("role/shortlinks-prod-gha-deploy");
    expect(workflow).toContain("EXPECTED_SERVICE: shortlinks-prod");
    expect(workflow).toContain("EXPECTED_WEB_FAMILY: shortlinks-prod");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: shortlinks-prod-migrate");
    expect(workflow).toContain("EXPECTED_CPU_ARCHITECTURE: X86_64");
    expect(workflow).toContain("--platform linux/amd64");
    expect(workflow).toContain("--target runtime");
    expect(workflow).toContain("dist/serve/index.js --version");
  });

  test("scans before credentials and deploys only the digest after migration succeeds", () => {
    const localScan = workflow.indexOf("Enforce local vulnerability gate");
    const credentials = workflow.indexOf("Configure AWS credentials with GitHub OIDC");
    const migration = workflow.indexOf("Run one-shot migration task on the digest");
    const deploy = workflow.indexOf("Register digest-pinned task definition and update service");
    expect(localScan).toBeGreaterThan(0);
    expect(credentials).toBeGreaterThan(localScan);
    expect(migration).toBeGreaterThan(credentials);
    expect(deploy).toBeGreaterThan(migration);
    expect(workflow).toContain('imageDigest="${DIGEST}"');
    expect(workflow).toContain('digest_image=%s@%s');
    expect(workflow).toContain('bash scripts/ci/verify-ecs-rollout.sh');
    expect(workflow).toContain('node scripts/ci/redact-log-lines.mjs');
  });

  test("verifies the fleet client key only after the deployment", () => {
    expect(workflow).toContain("provision_key:");
    expect(workflow).toContain("needs: [gate, deploy]");
    expect(workflow).toContain("uses: ./.github/workflows/fleet-key-provision.yml");
    expect(workflow).toContain("app: shortlinks");
    expect(workflow).toContain("source_sha: ${{ needs.gate.outputs.source_sha }}");
  });
});
