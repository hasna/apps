import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSandbox, type Sandbox } from "./testing/sandbox.js";
import { createCapsule } from "./capsule.js";
import { processBackupJob, type BackupWorkerApi, type BackupReceipt } from "./backup-worker.js";
import type { RemoteEntry } from "./client.js";
const boxes: Sandbox[] = [];
afterEach(() => { for (const box of boxes.splice(0)) box.cleanup(); });
function fixture() {
  const box = createSandbox(); boxes.push(box); const source = box.file("source", "protected bytes"); const capsule = box.path("payload.capsule"); const receipt = createCapsule(source, capsule);
  let entry: RemoteEntry = { ...receipt, id: randomUUID(), stationId: randomUUID(), originalPath: source, agent: { name: "proof", harness: null, session: null }, retentionDays: 90, version: 3, stationName: "station06", capturedAt: new Date().toISOString(), expiresAt: null, held: false, state: "trashed", backup: "requested" };
  let calls = 0; let fail = false; const jobId = randomUUID();
  const api: BackupWorkerApi = {
    async get() { return structuredClone(entry); },
    async claimBackup() { entry = { ...entry, version: entry.version + 1, backup: "running" }; return { entry: structuredClone(entry), job: { id: jobId, until: new Date(Date.now() + 60_000).toISOString() }, transfer: { method: "GET", url: "https://fixture-bucket.s3.us-east-1.amazonaws.com/capsule?X-Amz-Signature=fixture", headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() } }; },
    async completeBackup(_id, _version, job, backupReceipt) { expect(job).toBe(jobId); entry = { ...entry, version: entry.version + 1, backup: "verified", backupReceipt }; if (fail) throw new Error("lost response"); return structuredClone(entry); },
    async failBackup() { entry = { ...entry, version: entry.version + 1, backup: "failed" }; return structuredClone(entry); },
  };
  const sink = { async accept(input: { entry: RemoteEntry; capsule: string }): Promise<BackupReceipt> { calls++; expect(readFileSync(input.capsule)).toEqual(readFileSync(capsule)); return { id: "bkp-fixture", destination: "durable-fixture", artifactSha256: entry.artifact.sha256, held: true, restoreVerified: true, verifiedAt: new Date().toISOString() }; } };
  return { box, api, sink, id: entry.id, get entry() { return entry; }, get calls() { return calls; }, loseResponse() { fail = true; }, fetch: async () => new Response(readFileSync(capsule)) };
}
test("Backup worker verifies a capsule and accepts only held restore-tested receipts", async () => {
  const f = fixture(); const result = await processBackupJob(f.id, { api: f.api, sink: f.sink, workRoot: f.box.path("worker"), transferFetch: f.fetch });
  expect(result.backup).toBe("verified"); expect(f.calls).toBe(1);
  await processBackupJob(f.id, { api: f.api, sink: f.sink, workRoot: f.box.path("worker"), transferFetch: f.fetch }); expect(f.calls).toBe(1);
});
test("failed or invalid Backup receipts leave the entry protected and never mark it verified", async () => {
  const f = fixture();
  await expect(processBackupJob(f.id, { api: f.api, sink: { accept: async () => ({ ...(await f.sink.accept({ entry: f.entry, capsule: f.box.path("payload.capsule") })), held: false } as unknown as BackupReceipt) }, workRoot: f.box.path("worker"), transferFetch: f.fetch })).rejects.toThrow();
  expect(f.entry.backup).toBe("failed");
});
test("a lost completion response reconciles an already verified handoff", async () => {
  const f = fixture(); f.loseResponse();
  const result = await processBackupJob(f.id, { api: f.api, sink: f.sink, workRoot: f.box.path("worker"), transferFetch: f.fetch });
  expect(result.backup).toBe("verified"); expect(f.calls).toBe(1);
});
test("corrupted transfer bytes never reach Backup", async () => {
  const f = fixture(); await expect(processBackupJob(f.id, { api: f.api, sink: f.sink, workRoot: f.box.path("worker"), transferFetch: async () => new Response("corruption") })).rejects.toThrow();
  expect(f.calls).toBe(0); expect(f.entry.backup).toBe("failed");
});
