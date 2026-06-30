import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  bin: Record<string, string>;
  exports: Record<string, { import: string }>;
};

test("published package exports and bins are usable after build", async () => {
  const exportChecks: Record<string, string[]> = {
    ".": ["UptimeService", "UptimeStore", "buildHostedUptimeReport", "buildUptimeReport", "sanitizeEvidenceInput", "writePostgresReportArtifact", "buildPostgresReportAuditEvent", "exportPostgresReportAuditEvent"],
    "./api": ["createApiHandler", "serveUptime"],
    "./storage": ["UptimeStore"],
    "./probes": ["generateProbeKeyPair", "signProbeResult"],
    "./cloud-plan": ["buildAwsDeploymentPlan", "buildPrivateProbeCloudConfig"],
    "./postgres-plan": ["buildPostgresMigrationPlan", "renderPostgresMigrationPlan"],
    "./postgres": ["buildPostgresMigrationDryRun", "runPostgresMigration"],
    "./postgres-runtime": ["buildPostgresRuntimeReadiness", "buildPostgresPrivateProbePreflight", "createPostgresRuntime"],
    "./postgres-report-runtime": ["buildPostgresReportRuntimeReadiness", "createPostgresReportRuntime", "writePostgresReportArtifact", "buildPostgresReportAuditEvent", "exportPostgresReportAuditEvent"],
    "./workers": ["runHostedPublicChecksWorker", "runPostgresPublicProbeWorker", "runPostgresSchedulerWorker"],
    "./worker-metrics": ["buildWorkerRuntimeMetricEnvelope", "schedulerWorkerRuntimeMetrics", "publicProbeWorkerRuntimeMetrics", "reporterWorkerRuntimeMetrics"],
    "./edge-smoke": ["runEdgeSmoke"],
    "./evidence-sanitizer": ["sanitizeEvidenceInput"],
  };

  for (const [subpath, expected] of Object.entries(exportChecks)) {
    const specifier = subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    const loaded = await import(specifier) as Record<string, unknown>;
    for (const name of expected) expect(loaded[name]).toBeDefined();
  }

  for (const binPath of Object.values(pkg.bin)) {
    const absolute = join(root, binPath);
    expect(existsSync(absolute)).toBe(true);
    expect(statSync(absolute).mode & 0o111).not.toBe(0);
  }
});

test("generated report promotion evidence types require workspace binding", () => {
  const declaration = readFileSync(join(root, "dist/postgres-report-runtime.d.ts"), "utf8");
  const match = declaration.match(/interface PostgresReportRuntimePromotionEvidence \{[\s\S]*?\n\}/);

  expect(match?.[0]).toContain("workspaceId: string;");
  expect(match?.[0]).not.toContain("workspaceId?: string;");
});

test("generated API declarations expose hosted Postgres monitor adapter", () => {
  const declaration = readFileSync(join(root, "dist/api.d.ts"), "utf8");

  expect(declaration).toContain("interface HostedPostgresMonitorRuntime");
  expect(declaration).toContain("hostedPostgresRuntime?: HostedPostgresMonitorRuntime;");
  expect(declaration).toContain("upsertMonitorWithAudit(input:");
  expect(declaration).toContain("listMonitors(options?");
  expect(declaration).toContain("offset?: number;");
  expect(declaration).toContain("tombstoneResource(input:");
  expect(declaration).toContain("tombstoneMonitorWithAudit(input:");
});

test("package dry-run includes release artifacts and excludes source-only files", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "pm", "pack", "--dry-run"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode).toBe(0);
  const files = stdout
    .split("\n")
    .map((line) => line.match(/^packed\s+\S+\s+(.+)$/)?.[1])
    .filter((file): file is string => Boolean(file))
    .sort();

  for (const expected of [
    "dist/index.js",
    "dist/cli/index.js",
    "dist/mcp/index.js",
    "dist/evidence-sanitizer.js",
    "dist/worker-metrics.js",
    "Dockerfile.package",
    "docs/aws-deployment-runbook.md",
    "docs/cloud-source-of-truth.md",
    "docs/deployment-metadata.example.json",
    "docs/monitoring-product-contract.md",
    "docs/operational-tracking.md",
    "infra/aws/main.tf",
    "infra/aws/variables.tf",
    "infra/aws/terraform.tfvars.example",
    "infra/aws/README.md",
    "README.md",
    "LICENSE",
    "NOTICE",
    "SECURITY.md",
  ]) {
    expect(files).toContain(expected);
  }
  expect(files.some((file) => file.startsWith("src/"))).toBe(false);
  expect(files.some((file) => file.startsWith("tests/"))).toBe(false);
  expect(files.some((file) => file.startsWith(".env"))).toBe(false);
  expect(stderr).toBe("");
});
