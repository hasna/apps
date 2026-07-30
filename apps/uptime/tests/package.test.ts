import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  bin: Record<string, string>;
  exports: Record<string, { import: string }>;
  license: string;
  publishConfig: { access: string; provenance?: boolean };
  repository: { type: string; url: string };
  scripts: Record<string, string>;
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

const approvedCandidateCommit = "1f2e3d4c5b6a798877665544332211000ffeeddc";

type ReleaseDecision = Record<string, any>;

function approvedReleaseDecision(overrides: ReleaseDecision = {}): ReleaseDecision {
  return {
    schemaVersion: 1,
    reviewedAt: "2026-07-29",
    repository: "hasna/uptime",
    package: "@hasna/uptime",
    releaseVersion: "9.9.9",
    decision: "GO",
    explicitPublicApproval: true,
    releaseCandidateCommit: approvedCandidateCommit,
    observed: {
      githubVisibility: "PUBLIC",
      npmPackagePublic: true,
      npmRepositoryUrl: "git+https://github.com/hasna/uptime.git",
    },
    legal: { status: "PASS" },
    provenance: {
      status: "VERIFIED",
      npmAttestations: true,
      npmGitHead: approvedCandidateCommit,
      alternateEvidence: null,
      registryIntegrity: "sha512-approvedReleaseCandidateIntegrityValue==",
      registrySignature: true,
    },
    secretScan: { status: "PASS" },
    ...overrides,
  };
}

function registryStateFor(decision: ReleaseDecision, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    githubVisibility: decision.observed.githubVisibility,
    githubPrivate: decision.observed.githubVisibility === "PRIVATE",
    npm: {
      version: decision.releaseVersion,
      repository: { type: "git", url: decision.observed.npmRepositoryUrl },
      gitHead: decision.provenance.npmGitHead,
      dist: {
        integrity: decision.provenance.registryIntegrity,
        signatures: [{ keyid: "registry-key", sig: "registry-signature" }],
        attestations: {
          url: "https://registry.npmjs.org/-/npm/v1/attestations/@hasna/uptime@9.9.9",
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
      },
    },
    ...overrides,
  };
}

// The state npm reports for a version it does not hold, which is necessarily the
// state of the version any publish is about to create.
function unpublishedRegistryState(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    githubVisibility: "PUBLIC",
    githubPrivate: false,
    npmVersionPublished: false,
    npm: { version: null, repository: null, dist: {} },
    ...overrides,
  };
}

function evaluateApprovedRelease(
  gate: Record<string, any>,
  overrides: {
    decision?: ReleaseDecision;
    candidate?: Record<string, any>;
    clean?: boolean;
    provenancePublishing?: boolean;
    online?: Record<string, any>;
    phase?: string;
  } = {},
): Record<string, any> {
  const decision = overrides.decision ?? approvedReleaseDecision();
  return gate.evaluateReleaseDecision({
    decision,
    staticErrors: [],
    online: overrides.online ?? registryStateFor(decision),
    candidate: overrides.candidate ?? {
      resolved: decision.releaseCandidateCommit,
      containedInHead: true,
      changedPaths: ["docs/oss-release-decision.json"],
    },
    clean: overrides.clean ?? true,
    provenancePublishing: overrides.provenancePublishing ?? true,
    secretFindings: [],
    ...(overrides.phase ? { phase: overrides.phase } : {}),
  });
}

// Writes throwaway `gh`/`npm` executables so a test can drive the real registry
// probe in the gate rather than hand-feeding it a response it could never get.
function stubExecutables(scripts: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "uptime-release-stub-bin-"));
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), body, { mode: 0o755 });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const npmVersionNotFoundStub = `#!/usr/bin/env bash
printf '%s\\n' '{"error":{"code":"E404","summary":"No match found for version"}}'
exit 1
`;

function ghVisibilityStub(visibility: string): string {
  return `#!/usr/bin/env bash
printf '%s\\n' '{"visibility":"${visibility}","isPrivate":${visibility === "PRIVATE"}}'
`;
}

// How `npm view --json` fails for a version the registry does not hold: non-zero
// exit with the reason as JSON on stdout.
function npmVersionNotFound(): string {
  throw Object.assign(new Error("Command failed: npm view"), {
    status: 1,
    stdout: JSON.stringify({ error: { code: "E404", summary: "No match found for version" } }),
    stderr: "npm error code E404\n",
  });
}

function npmUnreachable(): string {
  throw Object.assign(new Error("npm error network request to https://registry.npmjs.org failed"), {
    status: 1,
    stdout: "",
    stderr: "npm error network request to https://registry.npmjs.org failed\n",
  });
}

function registryRunner(visibility: string, npmView: () => string): (name: string, args: string[]) => string {
  return (name: string) => {
    if (name === "gh") return JSON.stringify({ visibility, isPrivate: visibility === "PRIVATE" });
    if (name === "npm") return npmView();
    throw new Error(`unexpected command ${name}`);
  };
}

test("public OSS release decision stays fail-closed while visibility and provenance are unresolved", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const audit = gate.auditStaticRepository(root);
  const decision = audit.decision;
  const result = gate.evaluateReleaseDecision({
    decision,
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
    candidate: { resolved: null, containedInHead: false, changedPaths: [] },
    clean: true,
    provenancePublishing: audit.provenancePublishing,
    secretFindings: [],
  });

  expect(audit.errors).toEqual([]);
  expect(pkg.license).toBe("Apache-2.0");
  expect(pkg.repository.url).toBe("git+https://github.com/hasna/uptime.git");
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
  expect(result.blockers).toContain("release candidate commit is not recorded");
  expect(result.blockers).toContain("npm provenance or approved alternate source evidence is not verified");
});

test("every release blocker clears for an approved candidate whose version is already on the registry", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const result = evaluateApprovedRelease(gate);

  expect(result.auditErrors).toEqual([]);
  expect(result.blockers).toEqual([]);
  expect(result.releaseAllowed).toBe(true);
});

test("the registry probe reports the version under publish as absent instead of failing the audit", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const probe = { name: "@hasna/uptime" };
  const version = { releaseVersion: "9.9.9" };

  expect(gate.inspectOnlineState(probe, version, registryRunner("PUBLIC", npmVersionNotFound))).toEqual({
    githubVisibility: "PUBLIC",
    githubPrivate: false,
    npmVersionPublished: false,
    npm: { version: null, repository: null, dist: {} },
  });

  // Only a missing version is expected. A registry that cannot be reached at all
  // is still an audit failure, or the gate would pass on no evidence.
  expect(() => gate.inspectOnlineState(probe, version, registryRunner("PUBLIC", npmUnreachable)))
    .toThrow("npm error network request to https://registry.npmjs.org failed");

  expect(gate.inspectOnlineState(probe, version, registryRunner("PRIVATE", () => JSON.stringify({ version: "9.9.9", dist: {} })))).toMatchObject({
    githubVisibility: "PRIVATE",
    githubPrivate: true,
    npmVersionPublished: true,
  });
});

test("an approved candidate whose version the registry does not hold yet is allowed to publish", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  // The honest pre-publish record: no integrity, no gitHead, no attestation,
  // because only the publish being gated can produce them. Provenance is
  // verified as a capability — the trusted-publishing workflow.
  const decision = approvedReleaseDecision({
    provenance: {
      status: "VERIFIED",
      npmAttestations: false,
      npmGitHead: null,
      alternateEvidence: null,
      registryIntegrity: null,
      registrySignature: true,
    },
  });
  const result = evaluateApprovedRelease(gate, { decision, online: unpublishedRegistryState() });

  expect(result.auditErrors).toEqual([]);
  expect(result.blockers).toEqual([]);
  expect(result.releaseAllowed).toBe(true);

  // Without the capability there is nothing to stand in for the attestation.
  const withoutWorkflow = evaluateApprovedRelease(gate, {
    decision,
    online: unpublishedRegistryState(),
    provenancePublishing: false,
  });
  expect(withoutWorkflow.blockers).toContain("npm provenance or approved alternate source evidence is not verified");
  expect(withoutWorkflow.releaseAllowed).toBe(false);
});

test("post-publish verification demands the attestation the publish minted", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const decision = approvedReleaseDecision();
  const attestationMissing = "published release has neither an npm provenance attestation nor approved alternate source evidence";

  const absent = evaluateApprovedRelease(gate, { decision, online: unpublishedRegistryState(), phase: gate.postPublishPhase });
  expect(absent.auditErrors).toContain("the npm registry has no 9.9.9, so the published release cannot be verified");
  expect(absent.auditErrors).toContain(attestationMissing);

  // A published release with no attestation, recorded honestly. The pre-publish
  // phase accepts it on capability alone; the post-publish phase must not.
  const unattestedDecision = approvedReleaseDecision({
    provenance: { ...approvedReleaseDecision().provenance, npmAttestations: false },
  });
  const unattested = registryStateFor(unattestedDecision);
  delete unattested.npm.dist.attestations;
  expect(evaluateApprovedRelease(gate, { decision: unattestedDecision, online: unattested }).releaseAllowed).toBe(true);
  expect(evaluateApprovedRelease(gate, { decision: unattestedDecision, online: unattested, phase: gate.postPublishPhase }).auditErrors)
    .toContain(attestationMissing);

  const unsigned = registryStateFor(decision);
  unsigned.npm.dist.signatures = [];
  expect(evaluateApprovedRelease(gate, { decision, online: unsigned, phase: gate.postPublishPhase }).auditErrors)
    .toContain("published release has no npm registry signature");

  const drifted = registryStateFor(decision);
  drifted.npm.gitHead = "0".repeat(40);
  expect(evaluateApprovedRelease(gate, { decision, online: drifted, phase: gate.postPublishPhase }).auditErrors)
    .toContain("published npm gitHead is not the approved release candidate commit");

  const verified = evaluateApprovedRelease(gate, { decision, phase: gate.postPublishPhase });
  expect(verified.auditErrors).toEqual([]);
});

test("the recorded-state audit succeeds when the npm registry does not hold the recorded version", async () => {
  const stub = stubExecutables({ gh: ghVisibilityStub("PRIVATE"), npm: npmVersionNotFoundStub });
  try {
    const result = Bun.spawnSync({
      cmd: ["node", "scripts/oss-release-gate.mjs", "--verify-recorded-state"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `${stub.dir}:${process.env.PATH ?? ""}` },
    });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    // A gate that cannot tolerate an absent version reports it as an audit error
    // and exits non-zero, which is what deadlocks `prepublishOnly`.
    expect(`exit ${result.exitCode}: ${stderr}`).toStartWith("exit 0:");
    expect(stderr).not.toContain("AUDIT ERROR");
    expect(stdout).toContain("Gate phase: pre-publish");
    // Proof the gate actually ran rather than exiting before the audit.
    expect(stdout).toContain(`OSS release decision: ${JSON.parse(readFileSync(join(root, "docs/oss-release-decision.json"), "utf8")).decision}`);
    expect(stderr).toContain("BLOCKED: ");
  } finally {
    stub.cleanup();
  }
}, 120_000);

test("the release workflow authenticates every step that runs the release gate", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

  expect(gate.auditReleaseWorkflowAuthentication(root)).toEqual({ errors: [] });
  expect(pkg.scripts["release:oss:verify"]).toBe("node scripts/oss-release-gate.mjs --verify-published");
  expect(workflow).toContain("bun run release:oss:verify");

  const gateSteps = gate.releaseWorkflowSteps(workflow).filter((step: Record<string, string>) => /release:oss:|npm publish/.test(step.body));
  expect(gateSteps.map((step: Record<string, string>) => step.name)).toEqual([
    "Verify the recorded OSS release decision",
    "Publish to npm with provenance",
    "Verify the published provenance attestation",
  ]);
  for (const step of gateSteps) {
    expect(`${step.name}: ${/^\s*GH_TOKEN:/m.test(step.body)}`).toBe(`${step.name}: true`);
  }

  const fixture = mkdtempSync(join(tmpdir(), "uptime-release-workflow-auth-"));
  const fixtureWorkflow = join(fixture, ".github/workflows/release.yml");
  try {
    mkdirSync(join(fixture, ".github/workflows"), { recursive: true });
    // `gh` exits 4 with "populate the GH_TOKEN environment variable" here, so the
    // release job dies at this step on every tag push.
    writeFileSync(fixtureWorkflow, "jobs:\n  publish:\n    steps:\n      - name: Verify\n        run: bun run release:oss:audit\n");
    expect(gate.auditReleaseWorkflowAuthentication(fixture)).toEqual({
      errors: ['.github/workflows/release.yml step "Verify" runs the release gate without GH_TOKEN, so the gate cannot read GitHub visibility'],
    });

    // A workflow that never runs the gate must not pass this audit vacuously.
    writeFileSync(fixtureWorkflow, "jobs:\n  publish:\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n");
    expect(gate.auditReleaseWorkflowAuthentication(fixture)).toEqual({
      errors: [".github/workflows/release.yml never runs the release gate"],
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("approved alternate source evidence substitutes for npm attestations", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const decision = approvedReleaseDecision({
    provenance: {
      status: "VERIFIED",
      npmAttestations: false,
      npmGitHead: approvedCandidateCommit,
      alternateEvidence: {
        sourceCommit: approvedCandidateCommit,
        packageIntegrity: "sha512-approvedReleaseCandidateIntegrityValue==",
        approvedBy: "release-owner",
      },
      registryIntegrity: "sha512-approvedReleaseCandidateIntegrityValue==",
      registrySignature: true,
    },
  });
  const online = registryStateFor(decision);
  delete online.npm.dist.attestations;
  const result = evaluateApprovedRelease(gate, { decision, online });

  expect(result.auditErrors).toEqual([]);
  expect(result.blockers).toEqual([]);
  expect(result.releaseAllowed).toBe(true);
});

test("each release requirement blocks on its own when flipped away from the approved candidate", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const privateDecision = approvedReleaseDecision({
    observed: { githubVisibility: "PRIVATE", npmPackagePublic: true, npmRepositoryUrl: "git+https://github.com/hasna/uptime.git" },
  });

  const cases: Array<{ name: string; overrides: Parameters<typeof evaluateApprovedRelease>[1]; blocker: string }> = [
    {
      name: "recorded HOLD",
      overrides: { decision: approvedReleaseDecision({ decision: "HOLD" }) },
      blocker: "recorded public-release decision is HOLD",
    },
    {
      name: "approval absent",
      overrides: { decision: approvedReleaseDecision({ explicitPublicApproval: false }) },
      blocker: "explicit repository-public approval is absent",
    },
    {
      name: "repository still private",
      overrides: { decision: privateDecision, online: registryStateFor(privateDecision) },
      blocker: "GitHub repository is not public, so public package metadata is unresolved",
    },
    {
      name: "dirty worktree",
      overrides: { clean: false },
      blocker: "release candidate worktree is not clean",
    },
    {
      name: "no recorded candidate commit",
      overrides: {
        decision: approvedReleaseDecision({ releaseCandidateCommit: null }),
        candidate: { resolved: null, containedInHead: false, changedPaths: [] },
      },
      blocker: "release candidate commit is not recorded",
    },
    {
      name: "abbreviated candidate commit",
      overrides: {
        decision: approvedReleaseDecision({ releaseCandidateCommit: approvedCandidateCommit.slice(0, 10) }),
        candidate: { resolved: approvedCandidateCommit, containedInHead: true, changedPaths: [] },
      },
      blocker: "recorded release candidate commit is not a full 40-character commit SHA",
    },
    {
      name: "candidate commit missing from the repository",
      overrides: { candidate: { resolved: null, containedInHead: false, changedPaths: [] } },
      blocker: "recorded release candidate commit does not exist in this repository",
    },
    {
      name: "candidate commit not in the HEAD history",
      overrides: {
        candidate: { resolved: approvedCandidateCommit, containedInHead: false, changedPaths: [] },
      },
      blocker: "recorded release candidate commit is neither HEAD nor an ancestor of HEAD",
    },
    {
      name: "unapproved code after the candidate commit",
      overrides: {
        candidate: {
          resolved: approvedCandidateCommit,
          containedInHead: true,
          changedPaths: ["docs/oss-release-decision.json", "src/index.ts"],
        },
      },
      blocker: "HEAD changes src/index.ts since the recorded release candidate commit, so the published tree is not the approved one",
    },
    {
      name: "provenance not verified",
      overrides: {
        decision: approvedReleaseDecision({
          provenance: { ...approvedReleaseDecision().provenance, status: "MISSING" },
        }),
      },
      blocker: "npm provenance or approved alternate source evidence is not verified",
    },
    {
      name: "no trusted-publishing workflow",
      overrides: { provenancePublishing: false },
      blocker: "npm provenance publishing is not configured",
    },
  ];

  for (const { name, overrides, blocker } of cases) {
    const result = evaluateApprovedRelease(gate, overrides);
    expect(`${name}: ${JSON.stringify(result.blockers)}`).toBe(`${name}: ${JSON.stringify([blocker])}`);
    expect(result.releaseAllowed).toBe(false);
  }
});

test("recording the approved release candidate commit is reachable in real Git history", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const repository = mkdtempSync(join(tmpdir(), "uptime-release-candidate-"));
  const git = (...args: string[]): string => {
    const result = Bun.spawnSync({
      // -c core.hooksPath= and an empty global config insulate the fixture from
      // ambient configuration. Hasna machines set a global core.hooksPath whose
      // hooks write to stderr, and an unrelated global config must never decide
      // whether this test passes.
      cmd: ["git", "-c", "core.hooksPath=", ...args],
      cwd: repository,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "Release Gate Test",
        GIT_AUTHOR_EMAIL: "release-gate@example.invalid",
        GIT_COMMITTER_NAME: "Release Gate Test",
        GIT_COMMITTER_EMAIL: "release-gate@example.invalid",
      },
    });
    // Assert the exit code, never the stderr text: git writes advice and hook
    // output to stderr on success, so an empty-stderr assertion fails for
    // reasons that have nothing to do with the behaviour under test. stderr is
    // carried into the failure message instead of being asserted on.
    expect(`git ${args[0]} exited ${result.exitCode}: ${new TextDecoder().decode(result.stderr)}`).toStartWith(`git ${args[0]} exited 0:`);
    return new TextDecoder().decode(result.stdout).trim();
  };

  try {
    git("init", "--quiet", "--initial-branch", "main");
    mkdirSync(join(repository, "docs"), { recursive: true });
    writeFileSync(join(repository, "src.ts"), "export const value = 1;\n");
    writeFileSync(join(repository, "docs/oss-release-decision.json"), JSON.stringify({ releaseCandidateCommit: null }, null, 2));
    git("add", "src.ts", "docs/oss-release-decision.json");
    git("commit", "--quiet", "-m", "release candidate");
    const candidateCommit = git("rev-parse", "HEAD");

    // Record the approved commit, which necessarily produces a child commit.
    writeFileSync(join(repository, "docs/oss-release-decision.json"), JSON.stringify({ releaseCandidateCommit: candidateCommit }, null, 2));
    git("add", "docs/oss-release-decision.json");
    git("commit", "--quiet", "-m", "record approved release candidate");

    const candidate = gate.inspectReleaseCandidate(candidateCommit, repository);
    expect(candidate.resolved).toBe(candidateCommit);
    expect(candidate.containedInHead).toBe(true);
    expect(candidate.changedPaths).toEqual(["docs/oss-release-decision.json"]);
    expect(gate.releaseCandidateBlockers(candidateCommit, candidate)).toEqual([]);

    // Any later code change means the tree being published is not the approved one.
    writeFileSync(join(repository, "src.ts"), "export const value = 2;\n");
    git("add", "src.ts");
    git("commit", "--quiet", "-m", "unapproved change");
    const drifted = gate.inspectReleaseCandidate(candidateCommit, repository);
    expect(drifted.containedInHead).toBe(true);
    expect(drifted.changedPaths.sort()).toEqual(["docs/oss-release-decision.json", "src.ts"]);
    expect(gate.releaseCandidateBlockers(candidateCommit, drifted)).toEqual([
      "HEAD changes src.ts since the recorded release candidate commit, so the published tree is not the approved one",
    ]);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("npm provenance is requested by the release workflow rather than publishConfig", async () => {
  const gate = await import(join(root, "scripts/oss-release-gate.mjs")) as Record<string, any>;
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

  // publishConfig.provenance makes npm refuse to publish outside GitHub Actions
  // or GitLab CI, which would brick every local and patch release.
  expect(pkg.publishConfig).toEqual({ access: "public" });
  expect(workflow).toContain("id-token: write");
  expect(workflow).toMatch(/npm publish[^\n]*--provenance/);
  expect(gate.auditProvenancePublishing(root)).toEqual({ configured: true, errors: [] });

  const missingWorkflowRoot = mkdtempSync(join(tmpdir(), "uptime-release-workflow-"));
  try {
    expect(gate.auditProvenancePublishing(missingWorkflowRoot)).toEqual({
      configured: false,
      errors: [".github/workflows/release.yml is missing, so no trusted-publishing workflow can generate npm provenance"],
    });
  } finally {
    rmSync(missingWorkflowRoot, { recursive: true, force: true });
  }
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
