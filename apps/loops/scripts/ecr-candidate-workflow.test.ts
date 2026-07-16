import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflowPath = new URL("../.github/workflows/ecr-candidate.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

function position(fragment: string): number {
  const index = workflow.indexOf(fragment);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("ECR candidate workflow contract", () => {
  test("is manual, exact-commit, confirmed, and main-reachable", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("^[0-9a-f]{40}$");
    expect(workflow).toContain('"push ${SOURCE_SHA}"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "${SOURCE_SHA}"');
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("refs/remotes/origin/main");
    expect(workflow).toContain('SAFE_SOURCE_SHA=%s\\n');
  });

  test("uses a protected ARM64 job and minimum OIDC permissions", () => {
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
    expect(workflow).toContain("environment: ecr-candidate");
    expect(workflow).toMatch(/permissions:\n  contents: read\n  id-token: write/);
    expect(workflow).not.toMatch(/packages:\s*write/);
    expect(workflow).not.toMatch(/security-events:\s*write/);
  });

  test("fails closed on repository configuration", () => {
    for (const variable of ["AWS_REGION", "AWS_ROLE_ARN", "ECR_REPOSITORY"]) {
      expect(workflow).toContain(`vars.${variable}`);
    }
    expect(workflow).toContain("ECR repository must enforce IMMUTABLE tags");
    expect(workflow).toContain("ECR repository must enable scan-on-push");
    expect(workflow).toContain("candidate tag already exists; refusing to overwrite");
  });

  test("scans before pushing and gates the completed ECR scan", () => {
    const localScan = position("Enforce local vulnerability gate");
    const login = position("Log in to Amazon ECR");
    const push = position("Push scanned immutable candidate");
    const wait = position("aws ecr wait image-scan-complete");
    const findings = position("aws ecr describe-image-scan-findings");
    expect(localScan).toBeLessThan(login);
    expect(login).toBeLessThan(push);
    expect(push).toBeLessThan(wait);
    expect(wait).toBeLessThan(findings);
    expect(workflow).toContain("severity: CRITICAL,HIGH");
    expect(workflow).toContain("critical > 0 || high > 0");
  });

  test("uses exact Docker target, immutable SHA tag, and emits evidence", () => {
    expect(workflow).toContain("--platform linux/arm64");
    expect(workflow).toContain("--file Dockerfile");
    expect(workflow).toContain("--target runner");
    expect(workflow).toContain('candidate_tag="candidate-${short_sha}-${SOURCE_SHA}"');
    expect(workflow).not.toMatch(/docker (?:tag|push)[^\n]*:latest/);
    expect(workflow).not.toMatch(/aws\s+ecs\b/);
    expect(workflow).toContain("openloops-candidate.sbom.cdx.json");
    expect(workflow).toContain("openloops-candidate.provenance.json");
    expect(workflow).toContain("ecr-scan-counts.json");
    expect(workflow).toContain("ECS/latest mutation: \\`none\\`");
  });

  test("pins every third-party action to a full commit SHA", () => {
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(6);
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }
  });
});
