import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const workflowPath = new URL("../.github/workflows/ecr-candidate.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");
const severities = ["CRITICAL", "HIGH"] as const;
const sourceContractsJson = workflow.match(/^  SOURCE_CONTRACTS_JSON: '([^']+)'$/m)?.[1];

if (!sourceContractsJson) {
  throw new Error("ECR candidate workflow source contracts were not found");
}

const sourceContracts = JSON.parse(sourceContractsJson) as Record<
  string,
  { ref: string; expectedSha: string | null; expectedPackageVersion: string | null }
>;

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

function stepScript(name: string): string {
  const stepStart = workflow.indexOf(`      - name: ${name}\n`);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const runMarker = "        run: |\n";
  const runStart = workflow.indexOf(runMarker, stepStart);
  expect(runStart).toBeGreaterThan(stepStart);
  const scriptStart = runStart + runMarker.length;
  const nextStep = workflow.indexOf("\n      - name:", scriptStart);
  const scriptEnd = nextStep === -1 ? workflow.length : nextStep;
  return workflow
    .slice(scriptStart, scriptEnd)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
    .trimEnd();
}

const preflightScript = stepScript("Validate dispatch and configuration");
const verifySourceScript = stepScript("Verify exact commit against permitted source");
const localScanScript = stepScript("Enforce local vulnerability gate");

function runShell(script: string, cwd: string, env: Record<string, string>) {
  return Bun.spawnSync({
    cmd: ["bash", "-c", script],
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runGit(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function writePackageVersion(repo: string, version: string): void {
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`);
  runGit(repo, "add", "package.json");
}

function createSourceFixture(options: { laterMaintenanceCommit?: boolean; wrongMaintenanceVersion?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "loops-ecr-source-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  mkdirSync(repo);
  runGit(repo, "init", "--initial-branch=main");
  runGit(repo, "config", "user.name", "ECR source fixture");
  runGit(repo, "config", "user.email", "fixture@example.invalid");

  writePackageVersion(repo, "0.4.28");
  runGit(repo, "commit", "-m", "fixture base");
  const baseSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "branch", "maint/0.4.28", baseSha);

  writePackageVersion(repo, "0.4.29");
  runGit(repo, "commit", "-m", "fixture main release");
  const mainSha = runGit(repo, "rev-parse", "HEAD");

  runGit(repo, "switch", "maint/0.4.28");
  writePackageVersion(repo, "0.4.28-offsite.1");
  runGit(repo, "commit", "-m", "fixture maintenance candidate");
  const preMergeMaintenanceSha = runGit(repo, "rev-parse", "HEAD");

  runGit(repo, "switch", "-c", "hardening", preMergeMaintenanceSha);
  writeFileSync(join(repo, "Dockerfile"), "FROM scratch\n");
  runGit(repo, "add", "Dockerfile");
  runGit(repo, "commit", "-m", "fixture maintenance hardening PR head");
  const maintenancePrHeadSha = runGit(repo, "rev-parse", "HEAD");
  runGit(repo, "switch", "maint/0.4.28");
  runGit(repo, "merge", "--no-ff", "hardening", "-m", "fixture maintenance hardening merge");
  const maintenanceSha = runGit(repo, "rev-parse", "HEAD");

  let wrongVersionSha: string | undefined;
  if (options.wrongMaintenanceVersion) {
    writePackageVersion(repo, "0.4.29");
    runGit(repo, "commit", "-m", "fixture wrong maintenance version");
    wrongVersionSha = runGit(repo, "rev-parse", "HEAD");
  }

  let laterMaintenanceSha: string | undefined;
  if (options.laterMaintenanceCommit) {
    writeFileSync(join(repo, "later-maintenance-change"), "later\n");
    runGit(repo, "add", "later-maintenance-change");
    runGit(repo, "commit", "-m", "fixture later maintenance change");
    laterMaintenanceSha = runGit(repo, "rev-parse", "HEAD");
  }

  runGit(repo, "switch", "-c", "feature/unreviewed", baseSha);
  writePackageVersion(repo, "0.4.28-offsite.1");
  runGit(repo, "commit", "-m", "fixture unreviewed source");
  const unreviewedSha = runGit(repo, "rev-parse", "HEAD");

  runGit(root, "init", "--bare", remote);
  runGit(repo, "remote", "add", "origin", remote);
  runGit(
    repo,
    "push",
    "origin",
    "main:refs/heads/main",
    "maint/0.4.28:refs/heads/maint/0.4.28",
    "feature/unreviewed:refs/heads/feature/unreviewed",
  );

  return {
    root,
    repo,
    baseSha,
    mainSha,
    preMergeMaintenanceSha,
    maintenancePrHeadSha,
    maintenanceSha,
    laterMaintenanceSha,
    unreviewedSha,
    wrongVersionSha,
  };
}

function runPreflight(sourceTrack: string) {
  const root = mkdtempSync(join(tmpdir(), "loops-ecr-preflight-"));
  const sourceSha = "a".repeat(40);
  const result = runShell(preflightScript, root, {
    AWS_REGION: "eu-central-1",
    AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/loops-ecr-candidate",
    ECR_REPOSITORY: "loops",
    SOURCE_TRACK: sourceTrack,
    SOURCE_SHA: sourceSha,
    CONFIRMATION: `push ${sourceSha}`,
    SOURCE_CONTRACTS_JSON: sourceContractsJson,
    GITHUB_OUTPUT: join(root, "output"),
    GITHUB_ENV: join(root, "env"),
  });
  return { root, result };
}

function runSourceVerification(
  fixture: ReturnType<typeof createSourceFixture>,
  sourceTrack: keyof typeof sourceContracts,
  sourceSha: string,
  expectedSourceSha = sourceTrack === "main" ? "" : fixture.maintenanceSha,
) {
  const contract = sourceContracts[sourceTrack];
  if (!contract) throw new Error(`missing source contract for ${sourceTrack}`);
  runGit(fixture.repo, "checkout", "--detach", sourceSha);
  const sourceBranch = contract.ref.replace(/^refs\/heads\//, "");
  return runShell(verifySourceScript, fixture.repo, {
    SOURCE_SHA: sourceSha,
    SAFE_SOURCE_REF: contract.ref,
    SAFE_SOURCE_REMOTE_REF: `refs/remotes/origin/${sourceBranch}`,
    EXPECTED_SOURCE_SHA: expectedSourceSha,
    EXPECTED_PACKAGE_VERSION: contract.expectedPackageVersion ?? "",
    GITHUB_ENV: join(fixture.root, "verified-env"),
  });
}

function runLocalScan(report: unknown) {
  const root = mkdtempSync(join(tmpdir(), "loops-ecr-local-scan-"));
  writeFileSync(join(root, "trivy-local.json"), `${JSON.stringify(report)}\n`);
  const result = runShell(localScanScript, root, {
    GITHUB_OUTPUT: join(root, "output"),
    GITHUB_ENV: join(root, "env"),
  });
  return { root, result };
}

describe("ECR candidate workflow contract", () => {
  test("is manual, exact-commit, confirmed, and restricted to explicit source lineages", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("source_track:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("^[0-9a-f]{40}$");
    expect(workflow).toContain('"push ${SOURCE_SHA}"');
    expect(workflow).toContain('actual_sha="$(git rev-parse --verify HEAD^{commit})"');
    expect(workflow).toContain('"${actual_sha}" != "${SOURCE_SHA}"');
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(sourceContracts).toEqual({
      main: { ref: "refs/heads/main", expectedSha: null, expectedPackageVersion: null },
      "maint/0.4.28": {
        ref: "refs/heads/maint/0.4.28",
        expectedSha: "361d351445c256e397dbeb654f112facb7c572ca",
        expectedPackageVersion: "0.4.28-offsite.1",
      },
    });
    expect(workflow).toContain('git fetch --no-tags origin "+${SAFE_SOURCE_REF}:${SAFE_SOURCE_REMOTE_REF}"');
    expect(workflow).toContain('"${SAFE_SOURCE_REMOTE_REF}^{commit}"');
    expect(workflow).toContain('-n "${EXPECTED_SOURCE_SHA}"');
    expect(workflow).toContain('"${SOURCE_SHA}" != "${EXPECTED_SOURCE_SHA}"');
    expect(workflow).toContain('"${package_version}" != "${EXPECTED_PACKAGE_VERSION}"');
    expect(workflow).toContain('SAFE_SOURCE_SHA=%s\\n');
    const inputBlock = workflow.slice(workflow.indexOf("inputs:"), workflow.indexOf("concurrency:"));
    expect(inputBlock).not.toContain("source_ref:");
    expect(inputBlock).toMatch(/options:\n\s+- main\n\s+- maint\/0\.4\.28/);
  });

  test("accepts an exact SHA reachable from main without adding a version gate", () => {
    const preflight = runPreflight("main");
    const fixture = createSourceFixture();
    try {
      expect(preflight.result.exitCode).toBe(0);
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain("SAFE_SOURCE_REF=refs/heads/main");
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain("EXPECTED_SOURCE_SHA=\n");
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain("EXPECTED_PACKAGE_VERSION=\n");
      const result = runSourceVerification(fixture, "main", fixture.mainSha);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(fixture.root, "verified-env"), "utf8")).toContain(
        "VERIFIED_PACKAGE_VERSION=\n",
      );
    } finally {
      rmSync(preflight.root, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("preserves main behavior for an exact older ancestor", () => {
    const fixture = createSourceFixture();
    try {
      const result = runSourceVerification(fixture, "main", fixture.baseSha);
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("accepts an exact maint/0.4.28 SHA with the maintenance package version", () => {
    const preflight = runPreflight("maint/0.4.28");
    const fixture = createSourceFixture();
    try {
      expect(preflight.result.exitCode).toBe(0);
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain(
        "SAFE_SOURCE_REF=refs/heads/maint/0.4.28",
      );
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain(
        "EXPECTED_SOURCE_SHA=361d351445c256e397dbeb654f112facb7c572ca",
      );
      expect(readFileSync(join(preflight.root, "env"), "utf8")).toContain(
        "EXPECTED_PACKAGE_VERSION=0.4.28-offsite.1",
      );
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.maintenanceSha);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(fixture.root, "verified-env"), "utf8")).toContain(
        "VERIFIED_PACKAGE_VERSION=0.4.28-offsite.1",
      );
    } finally {
      rmSync(preflight.root, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects the pre-hardening maintenance commit after the approved merge", () => {
    const fixture = createSourceFixture();
    try {
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.preMergeMaintenanceSha);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("does not match the exact approved maintenance merge");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects the reviewed PR head when the permitted maintenance ref points at its merge", () => {
    const fixture = createSourceFixture();
    try {
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.maintenancePrHeadSha);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("does not match the exact approved maintenance merge");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a later maintenance tip with the same package version", () => {
    const fixture = createSourceFixture({ laterMaintenanceCommit: true });
    try {
      expect(fixture.laterMaintenanceSha).toBeDefined();
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.laterMaintenanceSha!);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("does not match the exact approved maintenance merge");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects arbitrary refs because they are not source-track inputs", () => {
    const { root, result } = runPreflight("refs/heads/feature/unreviewed");
    try {
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("source_track is not permitted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a maintenance-reachable SHA with the wrong package version", () => {
    const fixture = createSourceFixture({ wrongMaintenanceVersion: true });
    try {
      expect(fixture.wrongVersionSha).toBeDefined();
      const result = runSourceVerification(
        fixture,
        "maint/0.4.28",
        fixture.wrongVersionSha!,
        fixture.wrongVersionSha!,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(
        "source package version does not match the selected maintenance contract",
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a 0.4.29 main SHA selected for the maintenance track", () => {
    const fixture = createSourceFixture();
    try {
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.mainSha);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("source_sha is not reachable from the permitted source ref");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a correct-version SHA outside the permitted maintenance ancestry", () => {
    const fixture = createSourceFixture();
    try {
      const result = runSourceVerification(fixture, "maint/0.4.28", fixture.unreviewedSha);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("source_sha is not reachable from the permitted source ref");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects empty and structurally malformed local Trivy reports", () => {
    for (const report of [
      {},
      { Results: null },
      { Results: [] },
      { Results: [{ Vulnerabilities: false }] },
      { Results: [{ Vulnerabilities: [{ Severity: "UNKNOWN" }] }] },
    ]) {
      const { root, result } = runLocalScan(report);
      try {
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain("local Trivy report is empty or malformed");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("accepts a well-formed clean local Trivy report", () => {
    const { root, result } = runLocalScan({ Results: [{ Target: "fixture", Vulnerabilities: null }] });
    try {
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(root, "env"), "utf8")).toContain("LOCAL_CRITICAL=0");
      expect(readFileSync(join(root, "env"), "utf8")).toContain("LOCAL_HIGH=0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a well-formed local Trivy report containing high findings", () => {
    const { root, result } = runLocalScan({
      Results: [{ Target: "fixture", Vulnerabilities: [{ Severity: "HIGH" }] }],
    });
    try {
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("local Trivy gate failed: critical=0, high=1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    expect(workflow).toContain("openloops-candidate.sbom.cdx.json");
    expect(workflow).toContain("openloops-candidate.provenance.json");
    expect(workflow).toContain("ecr-scan-counts.json");
    expect(workflow).toContain("sourceTrack: $source_track");
    expect(workflow).toContain("sourceRef: $source_ref");
    expect(workflow).toContain('packageVersion: (if $package_version == "" then null else $package_version end)');
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
