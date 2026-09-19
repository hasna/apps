import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "deploy-domains.yml"), "utf8");
const livePg = readFileSync(join(root, ".github", "workflows", "domains-live-postgres.yml"), "utf8");
const serverEntry = readFileSync(join(root, "apps", "domains", "src", "server", "index.ts"), "utf8");

describe("Domains production deployment workflow", () => {
  test("resolves every production target from validated protected configuration", () => {
    expect(workflow).toContain("name: deploy-domains");
    for (const variable of [
      "DOMAINS_PROD_AWS_REGION",
      "DOMAINS_PROD_DEPLOY_MANIFEST",
      "DOMAINS_PROD_ECS_CLUSTER",
      "DOMAINS_PROD_ECS_SERVICE",
      "DOMAINS_PROD_WEB_TASK_FAMILY",
      "DOMAINS_PROD_WEB_CONTAINER",
      "DOMAINS_PROD_ECR_REPOSITORY",
      "DOMAINS_PROD_MIGRATION_TASK_FAMILY",
      "DOMAINS_PROD_MIGRATION_CONTAINER",
      "DOMAINS_PROD_CPU_ARCHITECTURE",
      "DOMAINS_PROD_CLIENT_KEY_SECRET_ID",
      "DOMAINS_PROD_AWS_ACCOUNT_ID",
      "DOMAINS_PROD_GHA_ROLE_ARN",
    ]) expect(workflow).toContain(variable);
    expect(workflow).not.toMatch(/\b\d{12}\b/);
    expect(workflow).not.toMatch(/arn:aws[a-z-]*:iam::\d{12}:role\//);
    for (const name of ["EXPECTED_CLUSTER", "EXPECTED_SERVICE", "EXPECTED_WEB_FAMILY", "EXPECTED_ECR_REPOSITORY", "EXPECTED_MIGRATION_FAMILY"]) {
      expect(workflow).toContain(`${name}: $` + "{{ vars.DOMAINS_PROD_");
    }
  });

  test("projects required provider secrets from the reviewed manifest into the candidate task", () => {
    expect(workflow).toContain("web_secrets=\"$(jq -ce");
    expect(workflow).toContain('has("CLOUDFLARE_API_TOKEN")');
    expect(workflow).toContain("MANIFEST_WEB_SECRETS");
    expect(workflow).toContain("required_secrets");
    expect(workflow).toContain("valueFrom:.value");
  });

  test("projects required hosted-provisioning settings from the reviewed manifest", () => {
    expect(workflow).toContain('has("CLOUDFLARE_ACCOUNT_ID") and has("DOMAINS_REGISTRANT_SOURCE_DOMAIN")');
    expect(workflow).toContain("MANIFEST_WEB_ENVIRONMENT");
    expect(workflow).toContain("required_environment");
    expect(workflow).toContain("value:.value");
  });

  test("refuses a failed service pointer as a rollback anchor", () => {
    expect(workflow).toContain('rolloutState == "COMPLETED"');
    expect(workflow).toContain('rolloutState == "FAILED"');
    expect(workflow).toContain("Domains service requires reconciliation before deployment");
  });

  test("binds migration state before service mutation and refuses unsafe rollback", () => {
    const catalog = workflow.indexOf("Build exact migration ID and checksum catalog");
    const before = workflow.indexOf("Capture exact pre-migration ledger receipt");
    const migrate = workflow.indexOf("Run one-shot migration task on the exact digest");
    const after = workflow.indexOf("Capture exact post-migration ledger receipt");
    const classify = workflow.indexOf("Classify migration result and refuse uncertain state");
    const deploy = workflow.indexOf("Register digest-pinned task definition and update service");
    expect(catalog).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(catalog);
    expect(migrate).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(migrate);
    expect(classify).toBeGreaterThan(after);
    expect(deploy).toBeGreaterThan(classify);
    expect(workflow).toContain("RECONCILIATION_REQUIRED");
    expect(workflow).toContain("schema_advanced == 'true'");
    expect(workflow).toContain("schema_advanced == 'false'");
    expect(workflow).toContain("assert-service-anchor.sh");
    expect(workflow).toContain("restore-service-anchor.sh");
    expect(workflow).toContain("automatic_rollback_performed:false");
  });

  test("proves canonical readiness and an authenticated single-/v1 provisioning read", () => {
    expect(workflow).toContain('"https://api.hasna.com/domains/ready"');
    expect(workflow).toContain('"https://api.hasna.com/domains"');
    expect(workflow).toContain("verify-canonical-data-plane.sh");
    expect(workflow).toContain("readiness-canonical.json");
    expect(workflow).toContain("data-plane-canonical.json");
    expect(workflow).not.toContain("https://api.hasna.com/domains/v1/v1");
  });

  test("runs a dedicated disposable PostgreSQL provisioning proof", () => {
    expect(livePg).toContain("name: domains-live-postgres");
    expect(livePg).toContain("postgres:16-alpine");
    expect(livePg).toContain("domains_provisioning_ci");
    expect(livePg).toContain("bun run test:postgres");
    expect(livePg).toContain("Refuse any non-disposable database target");
  });

  test("starts the durable provisioning scheduler before accepting HTTP traffic", () => {
    const startsProvisioning = serverEntry.indexOf("provisioning.start()");
    const startsHttp = serverEntry.indexOf("Bun.serve(");
    expect(startsProvisioning).toBeGreaterThan(0);
    expect(startsHttp).toBeGreaterThan(startsProvisioning);
    expect(serverEntry).toContain('DOMAINS_PROVISIONING_INTERVAL_MS');
  });
});
