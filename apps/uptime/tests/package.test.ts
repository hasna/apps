import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  bin: Record<string, string>;
  exports: Record<string, { import: string }>;
  license: string;
  publishConfig: { access: string; provenance: boolean };
  repository: { type: string; url: string };
};

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

class PackageProbeRuntime {
  readonly probes = new Map<string, any>();
  readonly jobs = new Map<string, any>();
  readonly submissions: any[] = [];
  readonly audits: any[] = [];

  async upsertProbeIdentity(input: any): Promise<any> {
    const workspaceId = input.workspaceId ?? "default";
    const probe = {
      workspaceId,
      id: input.id,
      name: input.name,
      probeClass: input.probeClass,
      probeLocation: input.probeLocation ?? "default",
      machineId: input.machineId ?? null,
      publicKeyPem: input.publicKeyPem,
      publicKeyFingerprint: input.publicKeyFingerprint,
      enabled: input.enabled ?? true,
      capabilities: input.capabilities ?? {},
      lastSeenAt: null,
      version: 1,
    };
    this.probes.set(`${workspaceId}:${probe.id}`, probe);
    return probe;
  }

  async upsertProbeIdentityWithAudit(input: any, audit: any): Promise<any> {
    const probe = await this.upsertProbeIdentity(input);
    const event = await this.recordAuditEvent({ ...audit, resourceType: "probe_identity", resourceId: probe.id });
    return { probe, audit: event };
  }

  async getProbeIdentity(input: any): Promise<any | null> {
    return this.probes.get(`${input.workspaceId ?? "default"}:${input.id}`) ?? null;
  }

  async claimCheckJob(input: any): Promise<any | null> {
    const workspaceId = input.workspaceId ?? "default";
    const probe = this.probes.get(`${workspaceId}:${input.probeId}`);
    const job = this.jobs.get(`${workspaceId}:${input.jobId}`);
    if (!probe || !job) return null;
    const claimed = {
      ...job,
      status: "claimed",
      claimedByProbeId: probe.id,
      fencingToken: "fence_pkg",
      claimedAt: "2026-01-01T00:00:01.000Z",
      leaseExpiresAt: "2026-01-01T00:05:01.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      version: job.version + 1,
    };
    this.jobs.set(`${workspaceId}:${input.jobId}`, claimed);
    return claimed;
  }

  async claimCheckJobWithAudit(input: any, audit: any): Promise<any | null> {
    const job = await this.claimCheckJob(input);
    if (!job) return null;
    const event = await this.recordAuditEvent({ ...audit, resourceType: "check_job", resourceId: job.id });
    return { job, audit: event };
  }

  async submitProbeCheckResult(input: any): Promise<any> {
    const workspaceId = input.workspaceId ?? "default";
    const job = this.jobs.get(`${workspaceId}:${input.jobId}`);
    if (!job || job.claimedByProbeId !== input.probeId || job.fencingToken !== input.fencingToken) {
      throw new Error("probe check job completion conflict");
    }
    const result = {
      workspaceId,
      id: "chk_pkg",
      monitorId: job.monitorId,
      jobId: job.id,
      probeId: input.probeId,
      monitorRevision: job.monitorRevision,
      scheduleSlot: job.scheduleSlot,
      probeClass: "private",
      probeLocation: "pkg",
      probePolicyHash: job.probePolicyHash,
      checkedAt: input.checkedAt,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
      attemptCount: input.attemptCount ?? 1,
      evidence: input.evidence ?? null,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    const submission = {
      workspaceId,
      id: "psb_pkg",
      probeId: input.probeId,
      jobId: job.id,
      monitorId: job.monitorId,
      monitorRevision: job.monitorRevision,
      scheduleSlot: job.scheduleSlot,
      probeClass: "private",
      probeLocation: "pkg",
      probePolicyHash: job.probePolicyHash,
      payloadHash: input.payloadHash,
      checkResultId: result.id,
      nonce: input.nonce,
      checkedAt: input.checkedAt,
      submittedAt: "2026-01-01T00:00:02.000Z",
    };
    const completed = { ...job, status: "submitted", fencingToken: null, leaseExpiresAt: null, submittedResultId: result.id };
    this.jobs.set(`${workspaceId}:${job.id}`, completed);
    this.submissions.push(submission);
    return { job: completed, result, submission };
  }

  async submitProbeCheckResultWithAudit(input: any, audit: any): Promise<any> {
    const submitted = await this.submitProbeCheckResult(input);
    const event = await this.recordAuditEvent({ ...audit, resourceType: "check_job", resourceId: submitted.job.id });
    return { ...submitted, audit: event };
  }

  async recordAuditEvent(input: any): Promise<any> {
    this.audits.push(input);
    return {
      workspaceId: input.workspaceId ?? "default",
      id: `aud_pkg_${this.audits.length}`,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  seedJob(): void {
    const now = "2026-01-01T00:00:00.000Z";
    this.jobs.set("ws_pkg:job_pkg", {
      workspaceId: "ws_pkg",
      id: "job_pkg",
      monitorId: "mon_pkg",
      monitorRevision: 1,
      monitorSnapshot: {
        workspaceId: "ws_pkg",
        id: "mon_pkg",
        name: "Package private HTTP",
        kind: "http",
        url: "https://private.example.invalid/health",
        host: null,
        port: null,
        method: "GET",
        expectedStatus: 200,
        intervalSeconds: 60,
        timeoutMs: 5000,
        retryCount: 0,
        enabled: true,
        status: "unknown",
        lastCheckedAt: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      scheduleSlot: now,
      probePolicy: { probeClass: "private", locations: ["pkg"] },
      probePolicyHash: "hash_pkg",
      status: "pending",
      claimedByProbeId: null,
      fencingToken: null,
      dueAt: now,
      claimedAt: null,
      leaseExpiresAt: null,
      submittedResultId: null,
      deployGeneration: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

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

test("generated API declarations expose hosted Postgres adapters", () => {
  const apiDeclaration = readFileSync(join(root, "dist/api.d.ts"), "utf8");
  const indexDeclaration = readFileSync(join(root, "dist/index.d.ts"), "utf8");

  expect(apiDeclaration).toContain("interface HostedPostgresMonitorRuntime");
  expect(apiDeclaration).toContain("hostedPostgresRuntime?: HostedPostgresMonitorRuntime;");
  expect(apiDeclaration).toContain("upsertMonitorWithAudit(input:");
  expect(apiDeclaration).toContain("listMonitors(options?");
  expect(apiDeclaration).toContain("offset?: number;");
  expect(apiDeclaration).toContain("tombstoneResource(input:");
  expect(apiDeclaration).toContain("tombstoneMonitorWithAudit(input:");
  expect(apiDeclaration).toContain("interface HostedPostgresProbeRuntime");
  expect(apiDeclaration).toContain("probeId?: string;");
  expect(apiDeclaration).toContain("hostedPostgresProbeRuntime?: HostedPostgresProbeRuntime;");
  expect(apiDeclaration).toContain("upsertProbeIdentity(input:");
  expect(apiDeclaration).toContain("upsertProbeIdentityWithAudit(input:");
  expect(apiDeclaration).toContain("claimCheckJob(input:");
  expect(apiDeclaration).toContain("claimCheckJobWithAudit(input:");
  expect(apiDeclaration).toContain("submitProbeCheckResult(input:");
  expect(apiDeclaration).toContain("submitProbeCheckResultWithAudit(input:");
  expect(apiDeclaration).toContain("interface HostedPostgresReportRuntime");
  expect(apiDeclaration).toContain("hostedPostgresReportRuntime?: HostedPostgresReportRuntime;");
  expect(apiDeclaration).toContain("createReportScheduleWithAudit(input:");
  expect(apiDeclaration).toContain("updateReportScheduleWithAudit(input:");
  expect(apiDeclaration).toContain("tombstoneReportScheduleWithAudit(input:");
  expect(apiDeclaration).toContain("listReportRuns(options?");
  expect(apiDeclaration).toContain("listAuditEvents(options?");
  expect(indexDeclaration).toContain("HostedPostgresProbeRuntime");
  expect(indexDeclaration).toContain("HostedPostgresReportRuntime");
  expect(indexDeclaration).toContain("PostgresReportScheduleMutationAuditInput");
});

test("built API enforces probe-bound hosted adapter behavior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-package-"));
  try {
    const { UptimeService } = await import(pkg.name) as Record<string, any>;
    const { createApiHandler } = await import(`${pkg.name}/api`) as Record<string, any>;
    const { generateProbeKeyPair, signProbeResult } = await import(`${pkg.name}/probes`) as Record<string, any>;
    const service = new UptimeService({ dbPath: join(dir, "uptime.db"), mode: "hosted", allowHostedLocalStore: true });
    const runtime = new PackageProbeRuntime();
    const keyPair = generateProbeKeyPair();
    const handler = createApiHandler(service, {
      mode: "hosted",
      hostedPostgresProbeRuntime: runtime,
      hostedTokens: [
        { token: "admin", scopes: ["uptime:admin", "uptime:read"], workspaceId: "ws_pkg", actor: "admin" },
        { token: "probe", scopes: ["uptime:probe"], workspaceId: "ws_pkg", actor: "probe", probeId: "prb_pkg" },
        { token: "unbound", scopes: ["uptime:probe"], workspaceId: "ws_pkg", actor: "unbound" },
        { token: "read", scopes: ["uptime:read"], workspaceId: "ws_pkg", actor: "reader" },
      ],
    });
    const enroll = await handler(jsonRequest("https://uptime.test/api/v1/probes", "POST", {
      id: "prb_pkg",
      name: "Package probe",
      publicKeyPem: keyPair.publicKeyPem,
      probeClass: "private",
      probeLocation: "pkg",
    }, { origin: "https://uptime.test", authorization: "Bearer admin", "idempotency-key": "pkg-enroll" }));
    runtime.seedJob();
    const unboundClaim = await handler(jsonRequest("https://uptime.test/api/v1/probes/jobs/job_pkg/claim", "POST", {
      probeId: "prb_pkg",
    }, { origin: "https://uptime.test", authorization: "Bearer unbound" }));
    const claim = await handler(jsonRequest("https://uptime.test/api/v1/probes/jobs/job_pkg/claim", "POST", {
      probeId: "prb_pkg",
    }, { origin: "https://uptime.test", authorization: "Bearer probe", "idempotency-key": "pkg-claim" }));
    const claimed = await claim.json();
    const unsigned = {
      probeId: "prb_pkg",
      jobId: claimed.id,
      scheduleSlot: claimed.scheduleSlot,
      fencingToken: claimed.fencingToken,
      monitorId: claimed.monitorId,
      nonce: "pkg-nonce-1",
      checkedAt: "2026-01-01T00:00:30.000Z",
      status: "up",
      latencyMs: 17,
      statusCode: 200,
      error: null,
      attemptCount: 1,
      monitorRevision: claimed.monitorRevision,
      evidence: null,
    };
    const submit = await handler(jsonRequest("https://uptime.test/api/v1/probes/results", "POST", {
      ...unsigned,
      signature: signProbeResult(unsigned, keyPair.privateKeyPem),
    }, { origin: "https://uptime.test", authorization: "Bearer probe", "idempotency-key": "pkg-submit" }));
    const list = await handler(new Request("https://uptime.test/api/v1/probes", {
      headers: { authorization: "Bearer read" },
    }));

    expect(enroll.status).toBe(201);
    expect(JSON.stringify(await enroll.clone().json())).not.toContain("BEGIN PUBLIC KEY");
    expect(unboundClaim.status).toBe(403);
    expect(claim.status).toBe(200);
    expect(claimed.fencingToken).toBe("fence_pkg");
    expect(claimed.monitorSnapshot).toMatchObject({ id: "mon_pkg", kind: "http" });
    expect(submit.status).toBe(201);
    expect((await submit.json()).result.status).toBe("up");
    expect(list.status).toBe(501);
    expect(runtime.submissions).toHaveLength(1);
    expect(runtime.audits.map((audit) => audit.action)).toEqual(["probe_identity.upsert", "probe_job.claim", "probe_result.submit"]);
    service.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("public OSS release decision stays fail-closed while visibility and provenance are unresolved", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const audit = gate.auditStaticRepository(root);
  const decision = audit.decision;
  const result = gate.evaluateReleaseDecision({
    decision,
    package: audit.package,
    staticErrors: audit.errors,
    online: {
      githubVisibility: "PRIVATE",
      githubPrivate: true,
      npm: {
        version: decision.releaseVersion,
        repository: { type: "git", url: decision.observed.npmRepositoryUrl },
        gitHead: null,
        dist: {
          integrity: decision.provenance.registryIntegrity,
          signatures: [{ keyid: "registry-key", sig: "registry-signature" }],
        },
      },
    },
    commit: "0123456789012345678901234567890123456789",
    clean: true,
    secretFindings: [],
  });

  expect(audit.errors).toEqual([]);
  expect(pkg.license).toBe("Apache-2.0");
  expect(pkg.repository.url).toBe("git+https://github.com/hasna/uptime.git");
  expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
  expect(decision).toMatchObject({
    decision: "HOLD",
    explicitPublicApproval: false,
    releaseCandidateCommit: null,
    observed: { githubVisibility: "PRIVATE" },
    provenance: { status: "MISSING", npmAttestations: false, alternateEvidence: null },
  });
  expect(result.auditErrors).toEqual([]);
  expect(result.releaseAllowed).toBe(false);
  expect(result.blockers).toContain("explicit repository-public approval is absent");
  expect(result.blockers).toContain("GitHub repository is not public, so public package metadata is unresolved");
  expect(result.blockers).toContain("npm provenance or approved alternate source evidence is not verified");
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
    "docs/oss-release-decision.json",
    "docs/oss-release-readiness.md",
    "infra/aws/main.tf",
    "infra/aws/variables.tf",
    "infra/aws/terraform.tfvars.example",
    "infra/aws/README.md",
    "README.md",
    "LICENSE",
    "NOTICE",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    expect(files).toContain(expected);
  }
  expect(files.some((file) => file.startsWith("src/"))).toBe(false);
  expect(files.some((file) => file.startsWith("tests/"))).toBe(false);
  expect(files.some((file) => file.startsWith(".env"))).toBe(false);
  expect(stderr).toBe("");
});
