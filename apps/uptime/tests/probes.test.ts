import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signProbeResult, type ProbeSigningInput } from "../src/probes.js";
import { UptimeService } from "../src/service.js";
import type { CreateProbeResult, Monitor, ProbeCheckJob, ProbeResultSubmission } from "../src/types.js";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-probes-"));
  cleanup.push(dir);
  return join(dir, "uptime.db");
}

function signedSubmission(input: {
  probe: CreateProbeResult;
  monitor: Monitor;
  job: ProbeCheckJob;
  privateKeyPem: string;
  nonce?: string;
  status?: "up" | "down";
  checkedAt?: string;
  latencyMs?: number | null;
  statusCode?: number | null;
  error?: string | null;
  attemptCount?: number;
  monitorRevision?: number;
}): ProbeResultSubmission {
  const unsigned: ProbeSigningInput = {
    probeId: input.probe.id,
    jobId: input.job.id,
    scheduleSlot: input.job.scheduleSlot,
    fencingToken: input.job.fencingToken!,
    monitorId: input.monitor.id,
    nonce: input.nonce ?? `nonce_${crypto.randomUUID()}`,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    status: input.status ?? "up",
    latencyMs: input.latencyMs ?? 10,
    statusCode: input.statusCode ?? 200,
    error: input.error ?? null,
    attemptCount: input.attemptCount ?? 1,
    monitorRevision: input.monitorRevision ?? input.monitor.revision,
    evidence: null,
  };
  return {
    ...unsigned,
    signature: signProbeResult(unsigned, input.privateKeyPem),
  };
}

test("signed probe submission records a check result and completes the claimed job", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "private-api", kind: "http", url: "https://example.com/health" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-1" }).id,
    probeId: probe.id,
  });

  const submission = signedSubmission({
    probe,
    monitor,
    job,
    privateKeyPem: probe.privateKeyPem!,
    status: "down",
    statusCode: 503,
    error: "service unavailable",
  });
  const { result, receipt } = service.submitProbeResult(submission);

  expect(result.status).toBe("down");
  expect(receipt.jobId).toBe(job.id);
  expect(service.getProbeCheckJob(job.id)?.status).toBe("submitted");
  expect(service.getProbe(probe.id)?.lastSeenAt).toBe(receipt.submittedAt);
  expect(service.listIncidents({ status: "open" })).toHaveLength(1);
  service.close();
});

test("probe job creation is idempotent for a monitor schedule slot", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "private-api", kind: "http", url: "https://example.com/health" });

  const first = service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-idempotent" });
  const second = service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-idempotent" });

  expect(second.id).toBe(first.id);
  expect(second.monitorRevision).toBe(monitor.revision);
  service.close();
});

test("exact replay of a signed submission returns the original receipt and result", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-replay" }).id,
    probeId: probe.id,
  });
  const submission = signedSubmission({ probe, monitor, job, privateKeyPem: probe.privateKeyPem!, nonce: "replay-nonce" });

  const first = service.submitProbeResult(submission);
  const replay = service.submitProbeResult(submission);

  expect(replay.result.id).toBe(first.result.id);
  expect(replay.receipt.id).toBe(first.receipt.id);
  expect(service.listResults()).toHaveLength(1);
  service.close();
});

test("probe submissions reject invalid signatures without recording results", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-invalid-signature" }).id,
    probeId: probe.id,
  });
  const submission = signedSubmission({ probe, monitor, job, privateKeyPem: probe.privateKeyPem! });

  expect(() => service.submitProbeResult({ ...submission, signature: "not-valid" })).toThrow("signature is invalid");
  expect(service.listResults()).toHaveLength(0);
  expect(service.getProbeCheckJob(job.id)?.status).toBe("claimed");
  service.close();
});

test("probe submissions reject wrong fencing tokens", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-wrong-fence" }).id,
    probeId: probe.id,
  });
  const submission = signedSubmission({
    probe,
    monitor,
    job: { ...job, fencingToken: "fence_wrong" },
    privateKeyPem: probe.privateKeyPem!,
  });

  expect(() => service.submitProbeResult(submission)).toThrow("fencing token");
  expect(service.listResults()).toHaveLength(0);
  service.close();
});

test("probe submissions reject duplicate nonces", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const firstJob = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-nonce-1" }).id,
    probeId: probe.id,
  });
  const nonce = "same-nonce";
  service.submitProbeResult(signedSubmission({ probe, monitor, job: firstJob, privateKeyPem: probe.privateKeyPem!, nonce }));

  const secondJob = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-nonce-2" }).id,
    probeId: probe.id,
  });
  const duplicate = signedSubmission({ probe, monitor, job: secondJob, privateKeyPem: probe.privateKeyPem!, nonce });

  expect(() => service.submitProbeResult(duplicate)).toThrow("Probe nonce already submitted");
  expect(service.listResults()).toHaveLength(1);
  expect(service.getProbeCheckJob(secondJob.id)?.status).toBe("claimed");
  service.close();
});

test("expired probe jobs can be reclaimed with a new fencing token", () => {
  const RealDate = Date;
  const service = new UptimeService({ dbPath: tempDb() });
  try {
    const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
    const firstProbe = service.createProbe({ name: "private-probe-01" });
    const secondProbe = service.createProbe({ name: "spark02" });
    const job = service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-reclaim" });
    const firstClaim = service.claimProbeCheckJob({ jobId: job.id, probeId: firstProbe.id, leaseTtlMs: 1000 });

    globalThis.Date = class extends RealDate {
      constructor(value?: string | number | Date) {
        if (arguments.length === 0) super(RealDate.now() + 2000);
        else super(value as string | number | Date);
      }
      static now() {
        return RealDate.now() + 2000;
      }
    } as DateConstructor;

    const secondClaim = service.claimProbeCheckJob({ jobId: job.id, probeId: secondProbe.id, leaseTtlMs: 120_000 });
    globalThis.Date = RealDate;

    expect(secondClaim.claimedByProbeId).toBe(secondProbe.id);
    expect(secondClaim.fencingToken).not.toBe(firstClaim.fencingToken);
    const stale = signedSubmission({
      probe: firstProbe,
      monitor,
      job: firstClaim,
      privateKeyPem: firstProbe.privateKeyPem!,
    });
    expect(() => service.submitProbeResult(stale)).toThrow("claimed by another probe");
    service.close();
  } finally {
    globalThis.Date = RealDate;
  }
});

test("probe submissions reject stale monitor revisions", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://old.example" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-stale" }).id,
    probeId: probe.id,
  });
  service.updateMonitor(monitor.id, { url: "https://new.example" });

  const stale = signedSubmission({ probe, monitor, job, privateKeyPem: probe.privateKeyPem!, monitorRevision: monitor.revision });

  expect(() => service.submitProbeResult(stale)).toThrow("Monitor changed since probe job was created");
  expect(service.listResults()).toHaveLength(0);
  expect(service.getProbeCheckJob(job.id)?.status).toBe("claimed");
  service.close();
});

test("probe submissions reject jobs created before monitor updates even when signed with the current revision", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://old.example" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const job = service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-old-job" });
  const updated = service.updateMonitor(monitor.id, { url: "https://new.example" });
  const claimed = service.claimProbeCheckJob({ jobId: job.id, probeId: probe.id });
  const staleJob = signedSubmission({
    probe,
    monitor: updated,
    job: claimed,
    privateKeyPem: probe.privateKeyPem!,
    monitorRevision: updated.revision,
  });

  expect(job.monitorRevision).toBe(monitor.revision);
  expect(updated.revision).toBe(2);
  expect(() => service.submitProbeResult(staleJob)).toThrow("monitorRevision does not match submission");
  expect(service.listResults()).toHaveLength(0);
  service.close();
});

test("probe registration validates public keys and hosted service probe APIs fail closed", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  expect(() => service.createProbe({ name: "bad", publicKeyPem: "not-a-public-key" })).toThrow("valid PEM Ed25519");
  service.close();

  const hosted = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  expect(() => hosted.createProbe({ name: "private-probe-01" })).toThrow("hosted probe APIs require cloud check_jobs");
  expect(() => hosted.listProbes()).toThrow("hosted probe APIs require cloud check_jobs");
  hosted.close();
});

test("probe submissions require a claimed job and a fresh checkedAt timestamp", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const probe = service.createProbe({ name: "private-probe-01" });
  const unclaimed = service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-unclaimed" });
  const badJobState = signedSubmission({
    probe,
    monitor,
    job: { ...unclaimed, fencingToken: "fence_fake" },
    privateKeyPem: probe.privateKeyPem!,
  });

  expect(() => service.submitProbeResult(badJobState)).toThrow("not claimable");

  const claimed = service.claimProbeCheckJob({
    jobId: service.createProbeCheckJob({ monitorId: monitor.id, scheduleSlot: "slot-old" }).id,
    probeId: probe.id,
  });
  const old = signedSubmission({
    probe,
    monitor,
    job: claimed,
    privateKeyPem: probe.privateKeyPem!,
    checkedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  });

  expect(() => service.submitProbeResult(old)).toThrow("checkedAt is too old");
  expect(service.listResults()).toHaveLength(0);
  service.close();
});
