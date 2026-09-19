import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(
  join(import.meta.dir, "..", "..", "..", "..", ".github", "workflows", "deploy-domains.yml"),
  "utf8",
);

describe("Domains production deployment workflow", () => {
  test("pins the exact Domains authority and production target", () => {
    expect(workflow).toContain("name: deploy-domains");
    expect(workflow).toContain("DEPLOY_MANIFEST: /hasna/deploy/domains");
    expect(workflow).toContain("role/domains-prod-gha-deploy");
    expect(workflow).toContain("EXPECTED_SERVICE: domains-prod");
    expect(workflow).toContain("EXPECTED_WEB_FAMILY: domains-prod");
    expect(workflow).toContain("EXPECTED_MIGRATION_FAMILY: domains-prod-migrate");
    expect(workflow).toContain('DEPLOY_PATH_SCOPE: "apps/domains/**"');
  });

  test("deploys only a scanned digest after the exact migration task succeeds", () => {
    const migration = workflow.indexOf("Run one-shot migration task on the digest");
    const deploy = workflow.indexOf("Register digest-pinned task definition and update service");
    expect(workflow).toContain("--target runtime");
    expect(workflow).toContain("dist/server/index.js --version");
    expect(workflow).toContain("imageDigest=\"${DIGEST}\"");
    expect(migration).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(migration);
  });
});
