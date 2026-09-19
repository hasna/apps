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
    expect(workflow).toContain("EXPECTED_WEB_CONTAINER: shortlinks");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: shortlinks-prod-migrate");
    expect(workflow).toContain("EXPECTED_MIGRATION_CONTAINER: shortlinks-migrate");
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

  test("projects the reviewed Domains and router secrets into the live task anchor", () => {
    expect(workflow).toContain('web_secrets="$(jq -ce');
    expect(workflow).toContain('has("HASNA_DOMAINS_API_KEY")');
    expect(workflow).toContain('has("HASNA_LINK_ROUTER_SHARED_SECRET")');
    expect(workflow).toContain("MANIFEST_WEB_SECRETS");
    expect(workflow).toContain("PREVIOUS_TASK_DEFINITION");
    expect(workflow).toContain("required_secrets");
    expect(workflow).toContain("valueFrom:.value");
    expect(workflow).toContain("$required_secrets | has($name) | not");
  });

  test("rechecks the live service anchor immediately before mutation", () => {
    const register = workflow.indexOf("aws ecs register-task-definition", workflow.indexOf("Register digest-pinned task definition and update service"));
    const anchorRead = workflow.indexOf('current_service="$(aws ecs describe-services', register);
    const anchorCompare = workflow.indexOf('current_task_definition}" == "${PREVIOUS_TASK_DEFINITION}', anchorRead);
    const mutationReceipt = workflow.indexOf("service_mutated=true", anchorCompare);
    const updateService = workflow.indexOf("aws ecs update-service", mutationReceipt);
    expect(register).toBeGreaterThan(0);
    expect(anchorRead).toBeGreaterThan(register);
    expect(workflow).toContain("jq -e '(.failures | length == 0) and (.services | length == 1)'");
    expect(workflow).not.toContain("jq -e '.failures | length == 0 and (.services | length == 1)'");
    expect(anchorCompare).toBeGreaterThan(anchorRead);
    expect(mutationReceipt).toBeGreaterThan(anchorCompare);
    expect(updateService).toBeGreaterThan(mutationReceipt);
  });

  test("verifies the fleet client key only after the deployment", () => {
    expect(workflow).toContain("provision_key:");
    expect(workflow).toContain("needs: [gate, deploy]");
    expect(workflow).toContain("uses: ./.github/workflows/fleet-key-provision.yml");
    expect(workflow).toContain("app: shortlinks");
    expect(workflow).toContain("source_sha: ${{ needs.gate.outputs.source_sha }}");
  });
});
