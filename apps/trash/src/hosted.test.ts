import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { HostedTrash, HostedOperationError, type HostedApi } from "./hosted.js";
import { inspectCapsuleStream } from "./capsule.js";
import { entryDetails, type CaptureInput, type Entry, type Station } from "./api/domain.js";
import type { Operation } from "./journal.js";
import type { TransferGrant } from "./api/objects.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(checkpoint?: (point: string, operation: Operation) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-hosted-"))); roots.push(root);
  const station: Station = { id: randomUUID(), name: "station-test", hostname: "Mac", source: "tailscale", platform: "darwin", architecture: "arm64", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const entries = new Map<string, Entry>(); const objects = new Map<string, Buffer>(); const events: string[] = [];
  let authenticated = true; let uploadWorks = true; let loseCommit = false;
  const grant = (id: string, method: "GET" | "PUT", input: Entry): TransferGrant => ({
    url: `https://fixture-bucket.s3.us-east-1.amazonaws.com/${id}?X-Amz-Signature=fixture`, method,
    headers: method === "GET" ? {} : { "content-length": String(input.artifact.sizeBytes), "content-type": "application/octet-stream", "if-none-match": "*", "x-amz-checksum-sha256": Buffer.from(input.artifact.sha256, "hex").toString("base64"), "x-amz-server-side-encryption": "AES256" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const api: HostedApi = {
    async status() { events.push("status"); if (!authenticated) throw new Error("fixture auth failure"); return { app: "trash", version: "fixture", station, retentionDays: 90, listLimit: { default: 20, max: 100 } }; },
    async registerStation() { return station; },
    async get(id) { const entry = entries.get(id); if (!entry) throw new Error("missing entry"); return entryDetails(structuredClone(entry)); },
    async reserve(input: CaptureInput) { events.push("reserve"); if (!entries.has(input.id)) entries.set(input.id, { ...input, stationName: station.name, state: "uploading", version: 1, capturedAt: new Date().toISOString(), expiresAt: null, held: false, backup: "none", objectKey: input.id, objectVersion: null }); return this.get(input.id); },
    async upload(id) { const entry = entries.get(id)!; return { entry: entryDetails(entry), transfer: grant(id, "PUT", entry) }; },
    async verify(id) {
      events.push("verify"); const entry = entries.get(id)!;
      const actual = await inspectCapsuleStream(new Blob([objects.get(id)!]).stream(), entry.artifact.sizeBytes);
      expect(actual.sha256).toBe(entry.sha256);
      if (entry.state === "uploading") { entry.state = "ready"; entry.objectVersion = "verified"; entry.version++; }
      return this.get(id);
    },
    async commit(id) { events.push("commit"); const entry = entries.get(id)!; expect(entry.state).toBe("ready"); entry.state = "trashed"; entry.version++; if (loseCommit) throw new Error("lost commit response"); return this.get(id); },
    async recovery(id) { events.push("restore-lease"); const entry = entries.get(id)!; const lease = { id: randomUUID(), until: new Date(Date.now() + 60_000).toISOString() }; entry.restoreLease = { ...lease, principal: "fixture", stationId: station.id }; entry.version++; return { entry: entryDetails(entry), lease, transfer: grant(id, "GET", entry) }; },
    async restored(id, _version, leaseId, sha256) { const entry = entries.get(id)!; expect(leaseId).toBe(entry.restoreLease!.id); expect(sha256).toBe(entry.sha256); entry.state = "restored"; entry.version++; return this.get(id); },
  };
  const options = { api, operationRoot: join(root, "operations"), env: { HOME: root }, station: () => ({ name: station.name, hostname: station.hostname, source: station.source, platform: station.platform, architecture: station.architecture }), checkpoint,
    transferFetch: async (url: string, init?: RequestInit) => {
      const id = new URL(url).pathname.slice(1);
      if (init?.method === "PUT") { events.push("upload"); if (!uploadWorks) return new Response(null, { status: 503 }); objects.set(id, Buffer.from(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 200 }); }
      return new Response(objects.get(id)!);
    },
  };
  return { root, api, entries, objects, events, options, client: new HostedTrash(options), station,
    denyAuth() { authenticated = false; }, failUpload() { uploadWorks = false; }, allowUpload() { uploadWorks = true; }, loseCommit() { loseCommit = true; } };
}

test("hosted capture verifies remotely before source removal and restores a tree through an exclusive destination", async () => {
  const f = fixture(); const source = join(f.root, "source"); mkdirSync(source); mkdirSync(join(source, "empty"));
  writeFileSync(join(source, "résumé"), Buffer.from([0, 255, 3])); symlinkSync("missing", join(source, "dangling"));
  const entry = await f.client.put(source);
  expect(entry.state).toBe("trashed"); expect(existsSync(source)).toBe(false); expect(f.client.pending()).toEqual([]);
  expect(f.events.indexOf("verify")).toBeLessThan(f.events.indexOf("commit"));
  const restored = await f.client.restore(entry.id);
  expect(restored.entry.state).toBe("restored"); expect(restored.path).toBe(source);
  expect(readFileSync(join(source, "résumé"))).toEqual(Buffer.from([0, 255, 3])); expect(readlinkSync(join(source, "dangling"))).toBe("missing");
  expect(f.client.pending()).toEqual([]);
});

test("authentication and upload failures preserve original bytes; upload can resume from its durable journal", async () => {
  const denied = fixture(); const source = join(denied.root, "source"); writeFileSync(source, "original"); denied.denyAuth();
  await expect(denied.client.put(source)).rejects.toThrow(); expect(readFileSync(source, "utf8")).toBe("original"); expect(existsSync(denied.options.operationRoot)).toBe(false);
  const f = fixture(); const path = join(f.root, "source"); writeFileSync(path, "original"); f.failUpload();
  await expect(f.client.put(path)).rejects.toBeInstanceOf(HostedOperationError); expect(readFileSync(path, "utf8")).toBe("original");
  const pending = f.client.pending(); expect(pending.length).toBe(1); f.allowUpload();
  await f.client.recover(pending[0]!.id); expect(existsSync(path)).toBe(false); expect(f.client.pending()).toEqual([]);
});

test("source changes during upload are preserved without staging the changed source", async () => {
  let source = "";
  const f = fixture((point) => { if (point === "beforeStage") writeFileSync(source, "changed while uploading"); });
  source = join(f.root, "source"); writeFileSync(source, "original");
  await expect(f.client.put(source)).rejects.toBeInstanceOf(HostedOperationError);
  expect(readFileSync(source, "utf8")).toBe("changed while uploading"); expect(f.events).not.toContain("commit");
});

for (const point of ["afterStage", "afterCommit"]) test(`interruption ${point} leaves recoverable staged bytes and resumes without duplicating capture`, async () => {
  let interrupt = true;
  const f = fixture((step) => { if (step === point && interrupt) throw new Error("fixture interruption"); });
  const source = join(f.root, "source"); writeFileSync(source, "original");
  await expect(f.client.put(source)).rejects.toBeInstanceOf(HostedOperationError); expect(existsSync(source)).toBe(false);
  const pending = f.client.pending(); expect(pending.length).toBe(1); interrupt = false;
  await new HostedTrash(f.options).recover(pending[0]!.id);
  expect(f.entries.size).toBe(1); expect(f.client.pending()).toEqual([]);
  await f.client.restore([...f.entries.keys()][0]!); expect(readFileSync(source, "utf8")).toBe("original");
});

test("a lost commit response reconciles the hosted state before cleanup", async () => {
  const f = fixture(); const source = join(f.root, "source"); writeFileSync(source, "original"); f.loseCommit();
  await expect(f.client.put(source)).rejects.toBeInstanceOf(HostedOperationError);
  const operation = f.client.pending()[0]!; await f.client.recover(operation.id);
  expect(f.events.filter((event) => event === "commit").length).toBe(1); expect(f.client.pending()).toEqual([]);
});

test("restore refuses occupied destinations and cross-station implicit paths", async () => {
  const f = fixture(); const source = join(f.root, "source"); writeFileSync(source, "original"); const entry = await f.client.put(source);
  writeFileSync(source, "new occupant"); await expect(f.client.restore(entry.id)).rejects.toThrow(); expect(readFileSync(source, "utf8")).toBe("new occupant");
  f.entries.get(entry.id)!.stationId = randomUUID();
  await expect(f.client.restore(entry.id)).rejects.toThrow();
  const target = join(f.root, "other"); await f.client.restore(entry.id, { to: target }); expect(readFileSync(target, "utf8")).toBe("original");
});

test("restoration interrupted after writing resumes by checking the existing bytes", async () => {
  let interrupt = false;
  const f = fixture((point) => { if (point === "afterRestore" && interrupt) throw new Error("fixture interruption"); });
  const source = join(f.root, "source"); writeFileSync(source, "original"); const entry = await f.client.put(source); interrupt = true;
  await expect(f.client.restore(entry.id)).rejects.toBeInstanceOf(HostedOperationError); expect(readFileSync(source, "utf8")).toBe("original");
  interrupt = false; await f.client.recover(f.client.pending()[0]!.id); expect(f.client.pending()).toEqual([]);
});
