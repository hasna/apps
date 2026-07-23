import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflowPath = new URL("../.github/workflows/ecr-candidate.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");
const severities = ["CRITICAL", "HIGH"] as const;

function position(fragment: string): number {
  const index = workflow.indexOf(fragment);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function severityCountFilter(severity: (typeof severities)[number]): string {
  const marker = `if ! ${severity.toLowerCase()}="$(jq -er '`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const filterStart = start + marker.length;
  const filterEnd = workflow.indexOf(`' <<<"\${findings}")"`, filterStart);
  expect(filterEnd).toBeGreaterThan(filterStart);
  return workflow.slice(filterStart, filterEnd);
}

function runSeverityCountFilter(severity: (typeof severities)[number], findings: Record<string, unknown>) {
  return Bun.spawnSync({
    cmd: ["jq", "-er", severityCountFilter(severity)],
    stdin: Buffer.from(JSON.stringify(findings)),
    stdout: "pipe",
    stderr: "pipe",
  });
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

  test("scans before pushing and polls the exact digest to a completed ECR scan", () => {
    const localScan = position("Enforce local vulnerability gate");
    const login = position("Log in to Amazon ECR");
    const push = position("Push scanned immutable candidate");
    const scanStepStart = position("- name: Wait for ECR vulnerability scan");
    const scanStepEnd = position("- name: Generate source provenance statement");
    const scanStep = workflow.slice(scanStepStart, scanStepEnd);
    expect(localScan).toBeLessThan(login);
    expect(login).toBeLessThan(push);
    expect(push).toBeLessThan(scanStepStart);
    expect(scanStep).not.toContain("aws ecr wait image-scan-complete");
    expect(scanStep).toContain("max_attempts=60");
    expect(scanStep).toContain("retry_interval_seconds=15");
    expect(scanStep).toContain("attempt<=max_attempts");
    expect(scanStep).toContain("aws ecr describe-image-scan-findings");
    expect(scanStep).toContain('--image-id imageDigest="${REMOTE_DIGEST}"');
    expect(scanStep).toContain("ScanNotFoundException");
    expect(scanStep).toContain('"IN_PROGRESS"');
    expect(scanStep).toContain('"COMPLETE"');
    expect([...scanStep.matchAll(/^\s+("[A-Z_]+"|\*)\)$/gm)].map((match) => match[1])).toEqual([
      '"COMPLETE"',
      '"IN_PROGRESS"',
      "*",
    ]);
    expect([...scanStep.matchAll(/\bcontinue\b/g)]).toHaveLength(1);
    expect(scanStep.indexOf("ScanNotFoundException")).toBeLessThan(scanStep.indexOf("continue"));
    expect(scanStep).toContain("nontransient ECR scan query failed");
    expect(scanStep).toContain("empty or malformed scan status");
    expect(scanStep).toContain("terminal status");
    expect(scanStep).toContain("did not complete after");
    expect(scanStep).toContain('type == "number"');
    expect(scanStep.indexOf('"COMPLETE"')).toBeLessThan(scanStep.indexOf('if ! findings="'));
    expect(workflow).toContain("severity: CRITICAL,HIGH");
    expect(workflow).toContain("ignore-unfixed: false");
    expect(workflow).not.toContain("ignore-unfixed: true");
    expect(workflow).toContain("critical > 0 || high > 0");
  });

  for (const severity of severities) {
    test(`${severity} count defaults only when absent and accepts nonnegative integers`, () => {
      for (const [findings, expected] of [
        [{}, "0\n"],
        [{ [severity]: 0 }, "0\n"],
        [{ [severity]: 7 }, "7\n"],
      ] as const) {
        const result = runSeverityCountFilter(severity, findings);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toBe(expected);
      }
    });

    for (const [label, value] of [
      ["null", null],
      ["false", false],
      ["string", "0"],
      ["negative", -1],
      ["fractional", 0.5],
    ] as const) {
      test(`${severity} count rejects present ${label}`, () => {
        const result = runSeverityCountFilter(severity, { [severity]: value });
        expect(result.exitCode).not.toBe(0);
      });
    }
  }

  test("uses exact Docker target, immutable SHA tag, and emits evidence", () => {
    expect(workflow).toContain("--platform linux/arm64");
    expect(workflow).toContain("--file Dockerfile");
    expect(workflow).toContain("--target runner");
    expect(workflow).toContain('candidate_tag="candidate-${short_sha}-${SOURCE_SHA}"');
    expect(workflow).not.toMatch(/docker (?:tag|push)[^\n]*:latest/);
    expect(workflow).not.toMatch(/aws\s+ecs\b/);
    expect(workflow).toContain("loops-candidate.sbom.cdx.json");
    expect(workflow).toContain("loops-candidate.provenance.json");
    expect(workflow).toContain("ecr-scan-counts.json");
    expect(workflow).toContain("ECS/latest mutation: \\`none\\`");
  });

  test("pins every third-party action to an approved commit SHA", () => {
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    expect(uses).toEqual([
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25",
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25",
      "aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a",
      "aws-actions/amazon-ecr-login@d539f0932e70871a027e9d5a9d8fc38589180a64",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    ]);
  });
});
