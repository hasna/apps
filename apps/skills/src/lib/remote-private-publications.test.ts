import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { checkedPublicationDeclaration, type PrivatePublicationView } from "./remote-private-publications.js";
import * as sourceClient from "./remote-private-publications.js";
import * as sourceRecovery from "./private-publication-recovery.js";
import { pathToFileURL } from "node:url";
const installedPackage = process.env.SKILLS_PUBLICATION_TEST_PACKAGE;
const entry = process.env.SKILLS_PUBLICATION_TEST_ENTRY === "root" ? "dist/index.js" : "dist/sdk/index.js";
const installed = installedPackage ? await import(pathToFileURL(join(installedPackage, entry)).href) : undefined;
const { RemotePrivatePublicationsClient, PrivatePublicationError } = (installed ?? sourceClient) as typeof sourceClient;
const { preparePrivatePublication, continuePrivatePublication, inspectPrivatePublication, readPrivatePublicationRecovery } = (installed ?? sourceRecovery) as typeof sourceRecovery;
import type { RemoteWorkspaceSession } from "./remote-workspace-selection.js";

useDefaultTestTimeout();
const ids = Array.from({ length: 6 }, (_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
const [userId, organizationId, membershipId, skillId, intentId, versionId] = ids as [string, string, string, string, string, string];
const token = "publication-session-canary";
const session: RemoteWorkspaceSession = { token, user: { id: userId, membershipId, email: "publisher@example.test", displayName: null, role: "owner" }, organization: { id: organizationId, name: "Owned", slug: "owned" } };
const capability = { contractVersion: 1, enabled: true, authentication: "interactive-session", maxArchiveBytes: 16777216, uploadMaxTtlSeconds: 300, executionEnabled: false };
const originalFetch = globalThis.fetch, roots: string[] = [];
afterEach(() => { globalThis.fetch = originalFetch; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const client = () => new RemotePrivatePublicationsClient("https://skills.example.test", session);
const expires = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 60000).toISOString();
function signedUrl(expiresAt: string) {
  const date = new Date(Date.parse(expiresAt) - 60000).toISOString().replace(/[-:]/g, "").replace(".000", "");
  const query = new URLSearchParams({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${"A".repeat(20)}/${date.slice(0, 8)}/us-east-1/s3/aws4_request`, "X-Amz-Date": date,
    "X-Amz-Expires": "60", "X-Amz-Security-Token": "owned-signer-fixture", "X-Amz-SignedHeaders": "content-length;content-type;host;x-amz-checksum-sha256;x-amz-expected-bucket-owner", "X-Amz-Signature": "a".repeat(64) });
  return `https://owned-publications.s3.us-east-1.amazonaws.com/private-publication-staging/${organizationId}/${intentId}/bundle.tgz?${query}`;
}
function directory() { const root = mkdtempSync(join(realpathSync(tmpdir()), "private-publication-")); roots.push(root); return root; }
async function prepared(c = client()) {
  const root = directory(), source = scaffoldPortableSkill("private-publication-fixture", { rootDir: root }).path;
  const recovery = join(root, "recovery");
  const receipt = await preparePrivatePublication(c, source, recovery, { skillId, expectedCurrentVersionId: null, idempotencyKey: ids[5] });
  return { root, source, recovery, receipt, c };
}
function server() {
  const calls: { method: string; path: string }[] = [];
  let view: PrivatePublicationView | undefined, uploads = 0, enabled = true, lostBegin = false, lostPut = false, lostFinalize = false;
  let custom: ((url: URL, init?: RequestInit) => Response | Promise<Response> | undefined) | undefined;
  const state = {
    calls, get view() { return view!; }, get uploads() { return uploads; },
    disable() { enabled = false; }, loseBegin() { lostBegin = true; }, losePut() { lostPut = true; }, loseFinalize() { lostFinalize = true; },
    customize(fn: typeof custom) { custom = fn; },
  };
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input); const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname });
    expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit");
    const changed = await custom?.(url, init); if (changed) return changed;
    if (url.hostname.includes(".s3.")) {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(method).toBe("PUT"); expect(new Uint8Array(init?.body as Uint8Array).length).toBe(view!.archiveByteSize);
      uploads++; if (lostPut) { lostPut = false; throw Error("sensitive-provider-error"); } return new Response(null, { status: 200 });
    }
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    if (url.pathname === "/api/v1/capabilities") return Response.json({ contractVersion: 1, apiVersion: 1, privatePublishing: { ...capability, enabled } });
    if (url.pathname.endsWith("/publication-uploads")) {
      const d = checkedPublicationDeclaration(JSON.parse(String(init?.body)));
      view ??= { id: intentId, skillId, version: d.version, expectedCurrentVersionId: null, archiveSha256: d.archiveSha256, archiveByteSize: d.archiveByteSize,
        state: "awaiting_upload", expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date().toISOString(), versionId: null };
      if (lostBegin) { lostBegin = false; throw Error("sensitive-begin-error"); }
      return Response.json({ changed: true, upload: view }, { status: 201 });
    }
    if (url.pathname.endsWith("/upload-url")) { const expiresAt = expires(); return Response.json({ upload: {
      method: "PUT", uploadUrl: signedUrl(expiresAt),
      expiresAt, headers: { "content-type": "application/gzip", "content-length": String(view!.archiveByteSize),
        "x-amz-checksum-sha256": Buffer.from(view!.archiveSha256, "hex").toString("base64"), "x-amz-expected-bucket-owner": "1".repeat(12) },
    } }); }
    if (url.pathname.endsWith("/finalize")) {
      view!.state = uploads ? "committed" : "needs_attention"; view!.versionId = uploads ? versionId : null;
      if (lostFinalize) { lostFinalize = false; throw Error("sensitive-finalize-error"); }
    } else if (method === "DELETE") view!.state = "cancelled";
    return Response.json({ upload: view });
  }) as typeof fetch;
  return state;
}

test("published source uses exact owned archive, one PUT, UUID CAS and bounded receipt without credentials", async () => {
  const s = server(), p = await prepared();
  const result = await continuePrivatePublication(p.c, p.recovery, { confirm: true, waitMs: 0 });
  expect(result).toMatchObject({ committed: true, executionEnabled: false, intentId, versionId, state: "committed" });
  expect(s.uploads).toBe(1); expect(s.calls.filter(c => c.method === "POST" && c.path.endsWith("/publication-uploads"))).toHaveLength(1);
  const receipt = readFileSync(join(p.recovery, "receipt.json"), "utf8");
  expect(receipt).not.toContain(token); expect(receipt).not.toContain("uploadUrl"); expect(receipt).not.toContain("Signature");
  expect(JSON.stringify(p.c)).not.toContain(token); expect(existsSync(join(p.recovery, "operation.lock"))).toBe(false);
  expect(readPrivatePublicationRecovery(p.recovery).bytes.length).toBe(p.receipt.declaration.archiveByteSize);
});

for (const lost of ["begin", "put", "finalize"] as const) test(`lost ${lost} response reuses the exact durable intent and never repeats PUT`, async () => {
  const s = server(), p = await prepared();
  if (lost === "begin") s.loseBegin(); else if (lost === "put") s.losePut(); else s.loseFinalize();
  const error = await continuePrivatePublication(p.c, p.recovery, { confirm: true, waitMs: 0 }).catch(e => e);
  expect(error).toBeInstanceOf(PrivatePublicationError); expect(error.uncertain).toBe(true); expect(JSON.stringify(error)).not.toContain("sensitive-");
  const before = readPrivatePublicationRecovery(p.recovery).receipt.declaration;
  const result = await continuePrivatePublication(p.c, p.recovery, { confirm: true, waitMs: 0 });
  expect(result.committed).toBe(true); expect(s.uploads).toBe(1);
  expect(readPrivatePublicationRecovery(p.recovery).receipt.declaration).toEqual(before);
  expect(s.calls.filter(c => c.path.endsWith("/publication-uploads"))).toHaveLength(lost === "begin" ? 2 : 1);
});

test("disabled publication refuses begin but permits existing status and cancel", async () => {
  const s = server(), p = await prepared(); await p.c.begin(skillId, p.receipt.declaration); s.disable(); s.calls.length = 0;
  await expect(p.c.begin(skillId, p.receipt.declaration)).rejects.toMatchObject({ code: "PUBLICATION_CAPABILITY_UNAVAILABLE" });
  expect(s.calls.every(c => c.path.endsWith("capabilities"))).toBe(true);
  expect((await p.c.get(skillId, intentId)).state).toBe("awaiting_upload"); expect((await p.c.cancel(skillId, intentId)).state).toBe("cancelled");
  await expect(p.c.finalize(skillId, intentId)).rejects.toMatchObject({ code: "PUBLICATION_CAPABILITY_UNAVAILABLE" }); expect(s.uploads).toBe(0);
});

test("capability absence, execution claims and unsupported contracts fail before mutation", async () => {
  const s = server(), p = await prepared();
  for (const privatePublishing of [undefined, { ...capability, contractVersion: 2 }, { ...capability, executionEnabled: true }, { ...capability, maxArchiveBytes: 16777217 }, { ...capability, extra: true }]) {
    s.calls.length = 0; s.customize(url => url.pathname.endsWith("capabilities") ? Response.json({ contractVersion: 1, apiVersion: 1, privatePublishing }) : undefined);
    await expect(p.c.begin(skillId, p.receipt.declaration)).rejects.toMatchObject({ code: "PUBLICATION_CONTRACT_UNAVAILABLE" }); expect(s.calls).toHaveLength(1);
  }
});

test("all declaration and selected intent bindings are checked before PUT", async () => {
  const s = server(), p = await prepared(), view = await p.c.begin(skillId, p.receipt.declaration);
  for (const changed of [{ archiveByteSize: 0 }, { archiveSha256: "a" }, { idempotencyKey: "not-a-uuid" }, { expectedCurrentVersionId: "revision-hash" }, { manifestText: "{}" }, { version: "other" }, { extra: true }])
    await expect(p.c.begin(skillId, { ...p.receipt.declaration, ...changed })).rejects.toBeInstanceOf(PrivatePublicationError);
  const bytes = readPrivatePublicationRecovery(p.recovery).bytes;
  for (const changed of [{ skillId: ids[0] }, { archiveByteSize: bytes.length + 1 }, { archiveSha256: "b".repeat(64) }, { state: "queued" }])
    await expect(p.c.upload(skillId, { ...view, ...changed } as PrivatePublicationView, bytes)).rejects.toBeInstanceOf(PrivatePublicationError);
  expect(s.uploads).toBe(0);
});

test("wrong tenant, capability destination, headers and expiration cannot receive archive bytes", async () => {
  const s = server(), p = await prepared(), view = await p.c.begin(skillId, p.receipt.declaration), bytes = readPrivatePublicationRecovery(p.recovery).bytes;
  const expiresAt = expires(), base = { method: "PUT", uploadUrl: signedUrl(expiresAt),
    expiresAt, headers: { "content-type": "application/gzip", "content-length": String(bytes.length), "x-amz-checksum-sha256": Buffer.from(view.archiveSha256, "hex").toString("base64"), "x-amz-expected-bucket-owner": "1".repeat(12) } };
  for (const changed of [{ method: "POST" }, { uploadUrl: base.uploadUrl.replace(organizationId, userId) }, { uploadUrl: base.uploadUrl.replace("amazonaws.com", "example.test") }, { uploadUrl: base.uploadUrl.replace("https:", "http:") },
    { expiresAt: new Date(0).toISOString() }, { expiresAt: new Date(Date.now() + 600000).toISOString() }, { headers: { ...base.headers, authorization: token } }, { headers: { ...base.headers, "content-length": "1" } }, { headers: { ...base.headers, "x-amz-checksum-sha256": "other" } }]) {
    s.customize(url => url.pathname.endsWith("/upload-url") ? Response.json({ upload: { ...base, ...changed } }) : undefined);
    await expect(p.c.upload(skillId, view, bytes)).rejects.toMatchObject({ code: "INVALID_PUBLICATION_RESPONSE" });
  }
  expect(s.uploads).toBe(0);
});

test("malformed successful mutation is uncertain and never trusted as another intent", async () => {
  const s = server(), p = await prepared();
  await p.c.begin(skillId, p.receipt.declaration);
  for (const change of [{ skillId: userId }, { archiveSha256: "0".repeat(64) }, { version: "another" }, { state: "committed", versionId: null }, { unexpected: token }]) {
    s.customize(url => url.pathname.endsWith("publication-uploads") ? Response.json({ upload: { ...s.view, ...change } }) : undefined);
    await expect(p.c.begin(skillId, p.receipt.declaration)).rejects.toMatchObject({ code: "PUBLICATION_UNCONFIRMED", uncertain: true });
  }
});

test("safe refusals never expose arbitrary server detail and do not retry", async () => {
  const s = server(), p = await prepared();
  for (const code of ["CURRENT_VERSION_CHANGED", "IDEMPOTENCY_CONFLICT", "VERSION_EXISTS", "MANIFEST_NAME_MISMATCH"]) {
    s.customize(url => url.pathname.endsWith("publication-uploads") ? Response.json({ code, error: token, detail: "\u001b[31m" }, { status: 409 }) : undefined);
    const before = s.calls.length, error = await p.c.begin(skillId, p.receipt.declaration).catch(e => e);
    expect(error.code).toBe(code); expect(error.uncertain).toBe(false); expect(JSON.stringify(error)).not.toContain(token); expect(error.message).not.toContain("\u001b"); expect(s.calls.length - before).toBe(2);
  }
});

test("bounded reads cancel overflowing, malformed UTF8 and stalled bodies", async () => {
  const s = server(); let cancelled = 0;
  for (const body of [new Uint8Array(65537), new Uint8Array([255])]) {
    s.customize(() => new Response(new ReadableStream({ start(c) { c.enqueue(body); c.close(); }, cancel() { cancelled++; } })));
    await expect(client().getCapability()).rejects.toMatchObject({ code: "INVALID_PUBLICATION_RESPONSE" });
  }
  s.customize(() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"contractVersion":1}')); }, cancel() { cancelled++; return new Promise(() => {}); } })));
  const start = Date.now(); await expect(client().getCapability({ timeoutMs: 25 })).rejects.toMatchObject({ code: "PUBLICATION_UNCONFIRMED" });
  expect(Date.now() - start).toBeLessThan(1000); expect(cancelled).toBeGreaterThan(0);
  const abort = new AbortController(); abort.abort(); s.calls.length = 0;
  await expect(client().getCapability({ signal: abort.signal })).rejects.toBeInstanceOf(PrivatePublicationError); expect(s.calls).toHaveLength(0);
});

test("recovery refuses changed bytes, symlinks, loose permissions, foreign context and concurrent actions", async () => {
  const s = server(), p = await prepared();
  const bytes = readFileSync(join(p.recovery, "bundle.tgz")); writeFileSync(join(p.recovery, "bundle.tgz"), "changed");
  await expect(continuePrivatePublication(p.c, p.recovery, { confirm: true })).rejects.toBeInstanceOf(PrivatePublicationError); expect(s.calls).toHaveLength(0);
  writeFileSync(join(p.recovery, "bundle.tgz"), bytes); chmodSync(join(p.recovery, "bundle.tgz"), 0o644);
  expect(() => readPrivatePublicationRecovery(p.recovery)).toThrow(PrivatePublicationError); chmodSync(join(p.recovery, "bundle.tgz"), 0o600);
  symlinkSync(p.recovery, join(p.root, "alias")); expect(() => readPrivatePublicationRecovery(join(p.root, "alias"))).toThrow();
  const other = new RemotePrivatePublicationsClient("https://skills.example.test", { ...session, organization: { ...session.organization, id: userId } });
  await expect(inspectPrivatePublication(other, p.recovery)).rejects.toMatchObject({ code: "PUBLICATION_IDENTITY_CHANGED" });
  writeFileSync(join(p.recovery, "operation.lock"), "owned concurrency fixture", { mode: 0o600 });
  await expect(continuePrivatePublication(p.c, p.recovery, { confirm: true })).rejects.toMatchObject({ code: "PUBLICATION_RECOVERY_BUSY" }); expect(s.calls).toHaveLength(0);
});

test("viewer and API-key-shaped credentials are refused without network", () => {
  const s = server();
  expect(() => new RemotePrivatePublicationsClient("https://skills.example.test", { ...session, user: { ...session.user, role: "viewer" } })).toThrow(PrivatePublicationError);
  expect(() => new RemotePrivatePublicationsClient("https://skills.example.test", { ...session, token: "sk_owned-fixture" })).toThrow(); expect(s.calls).toHaveLength(0);
});


test("bounded SDK wait preserves pending state and abort does not cancel server publication", async () => {
  const s = server(), p = await prepared();
  await p.c.begin(skillId, p.receipt.declaration); s.view.state = "queued";
  const start = Date.now(); expect((await p.c.wait(skillId, intentId, { timeoutMs: 25 })).state).toBe("queued");
  expect(Date.now() - start).toBeLessThan(250);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5);
  try { await expect(p.c.wait(skillId, intentId, { timeoutMs: 1000, signal: controller.signal })).rejects.toMatchObject({ code: "PUBLICATION_WAIT_ABORTED" }); }
  finally { clearTimeout(timer); }
  expect(s.calls.filter(c => c.method === "DELETE")).toHaveLength(0);
  s.view.state = "committed"; s.view.versionId = versionId;
  expect((await p.c.wait(skillId, intentId, { timeoutMs: 0 })).versionId).toBe(versionId);
});

test("resuming cancelled and expired intents cannot upload or finalize again", async () => {
  for (const state of ["cancelled", "expired"] as const) {
    const s = server(), p = await prepared();
    s.losePut(); await expect(continuePrivatePublication(p.c, p.recovery, { confirm: true, waitMs: 0 })).rejects.toMatchObject({ uncertain: true });
    s.view.state = state; const before = s.calls.length;
    const result = await continuePrivatePublication(p.c, p.recovery, { confirm: true, waitMs: 0 });
    expect(result).toMatchObject({ state, committed: false, executionEnabled: false });
    expect(s.calls.slice(before).every(c => c.method === "GET")).toBe(true); expect(s.uploads).toBe(1);
  }
});


test("recovery caps fd reads when a file grows after its initial stat", async () => {
  const p = await prepared(), file = join(p.recovery, "receipt.json"), original = readFileSync(file);
  const initial = fs.statSync(file), originalStat = fs.fstatSync, originalRead = fs.readSync;
  let grew = false, allocated = 0;
  const stat = spyOn(fs, "fstatSync").mockImplementation(((fd: number, options?: unknown) => {
    const result = originalStat(fd, options as any);
    if (!grew && result.ino === initial.ino) { grew = true; fs.appendFileSync(file, Buffer.alloc(1024 * 1024)); }
    return result;
  }) as typeof fs.fstatSync);
  const read = spyOn(fs, "readSync").mockImplementation(((fd: number, buffer: Uint8Array, ...args: unknown[]) => {
    if (originalStat(fd).ino === initial.ino) allocated = Math.max(allocated, buffer.byteLength);
    return (originalRead as Function)(fd, buffer, ...args);
  }) as typeof fs.readSync);
  try {
    expect(() => readPrivatePublicationRecovery(p.recovery)).toThrow(PrivatePublicationError);
    expect(grew).toBe(true); expect(allocated).toBe(original.length + 1); expect(allocated).toBeLessThan(65537);
  } finally { stat.mockRestore(); read.mockRestore(); }
});
