import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import type { TenantAuthContext } from "../lib/auth/tenant-auth.js";
import { BundleArtifactStorage, memoryObjectStore } from "../lib/bundle/artifact-storage.js";
import { buildManifest, writeBundleSkeleton, type LoopBundleDefinition } from "../lib/bundle/local.js";
import { computeBundleDigest, MODE_DATA, MODE_SCRIPT, serializeBundleManifest } from "../lib/bundle/manifest.js";
import { manifestFilesFor, ownBytes, packBundle, packBundleEntries } from "../lib/bundle/pack.js";
import type { LoopsApiServerOptions } from "./index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function principal(scopes: string[], roles: TenantAuthContext["roles"] = ["admin"]): TenantAuthContext {
  return {
    tenantId: "tenant-test",
    principalId: "principal-test",
    requestId: "request-test",
    kid: "kid-test",
    agent: "bundle-test",
    scopes,
    roles,
    tokenKind: "api_key",
    claims: { v: 1, kid: "kid-test", app: "loops", scopes, iat: 1, exp: null },
  };
}

async function createServer(
  storage: LoopStorageContract,
  artifacts: BundleArtifactStorage,
  auth: TenantAuthContext = principal(["loops:read", "loops:write", "loops:bundle"]),
  opts: LoopsApiServerOptions = {},
) {
  const mod = await import("./index.js");
  const server = mod.createLoopsApiServer({
    host: "127.0.0.1",
    port: 0,
    storage,
    artifacts,
    ...opts,
    authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal: auth }) },
    withTenantStorage: (_p, fn) => fn(storage),
  });
  cleanups.push(() => server.stop(true));
  return { server, url: (path: string) => `http://127.0.0.1:${server.port}${path}` };
}

function definition(id: string, overrides: Record<string, unknown> = {}): LoopBundleDefinition {
  return {
    schema: "hasna.loop.bundle.v1",
    id,
    name: "demo",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "scripts/run.sh", args: [] },
    maxAttempts: 3,
    ...overrides,
  } as LoopBundleDefinition;
}

/** Build a packed bundle plus the manifest an upload must carry. */
function packed(loopId: string, opts: { script?: string; defOverrides?: Record<string, unknown>; name?: string } = {}) {
  const dir = join(tempDir("loops-api-bundle-"), "demo");
  writeBundleSkeleton(dir, opts.name ?? "demo", definition(loopId, opts.defOverrides));
  writeFileSync(join(dir, "scripts", "run.sh"), opts.script ?? "#!/bin/sh\necho hi\n", { mode: MODE_SCRIPT });
  chmodSync(join(dir, "scripts", "run.sh"), MODE_SCRIPT);
  const bundle = packBundle(dir);
  const manifest = buildManifest({
    name: opts.name ?? "demo",
    loopId,
    version: 0,
    files: bundle.files,
    archiveSha256: bundle.archiveSha256,
  });
  return { dir, bundle, manifest };
}

function uploadForm(manifestJson: string, archive: Uint8Array): FormData {
  const form = new FormData();
  form.set("manifest", manifestJson);
  form.set("bundle", new Blob([new Uint8Array(archive)], { type: "application/zstd" }), "bundle.tar.zst");
  return form;
}

async function newStorage(): Promise<{ storage: LoopStorageContract; loopId: string }> {
  const storage = createSqliteLoopStorage(join(tempDir("loops-api-db-"), "loops.db"));
  cleanups.push(() => void storage.close());
  const loop = await storage.createLoop({
    name: "demo",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "scripts/run.sh" },
  });
  return { storage, loopId: loop.id };
}

function artifactStorage(): { artifacts: BundleArtifactStorage; keys: () => string[] } {
  const store = memoryObjectStore();
  return { artifacts: new BundleArtifactStorage({ bucket: "test-bucket", store }), keys: () => store.keys() };
}

describe("bundle version publish", () => {
  test("publishes version 1, writes both objects plus the latest pointer, and records a revision", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts, keys } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);

    const response = await fetch(url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { version: number; created: boolean; bundleDigest: string };
    expect(body).toMatchObject({ version: 1, created: true, bundleDigest: fixture.bundle.bundleDigest });

    expect(keys()).toEqual([
      "loops/tenant-test/demo/1/bundle.tar.zst",
      "loops/tenant-test/demo/1/manifest.json",
      "loops/tenant-test/demo/latest.json",
    ]);
    const revisions = await storage.listLoopRevisions(loopId);
    expect(revisions.total).toBe(1);
    expect(revisions.revisions[0]).toMatchObject({ version: 1, bundleName: "demo", storageKind: "s3", author: "principal-test" });
  });

  test("re-pushing an unchanged tree is idempotent: 200, created=false, no new version", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);
    const send = () =>
      fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive) });

    expect((await send()).status).toBe(201);
    const second = await send();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ created: false, version: 1 });
    expect((await storage.listLoopRevisions(loopId)).total).toBe(1);
  });

  test("a changed tree allocates the next version", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts, keys } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const first = packed(loopId);
    const second = packed(loopId, { script: "#!/bin/sh\necho hello\n" });

    await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(first.manifest), first.bundle.archive) });
    const response = await fetch(url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(second.manifest), second.bundle.archive),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ version: 2 });
    expect(keys()).toContain("loops/tenant-test/demo/2/bundle.tar.zst");
  });

  test.each([
    ["an unexpected part", (form: FormData) => form.set("extra", "x")],
    ["a string where the bundle must be a file", (form: FormData) => form.set("bundle", "not-a-file")],
    ["an empty bundle", (form: FormData) => form.set("bundle", new Blob([], { type: "application/zstd" }), "bundle.tar.zst")],
  ])("refuses %s", async (_label, mutate) => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);
    const form = uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive);
    mutate(form);
    const response = await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: form });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await storage.listLoopRevisions(loopId)).total).toBe(0);
  });

  test("refuses an archive whose bytes do not match the declared archiveSha256", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);
    const other = packed(loopId, { script: "#!/bin/sh\necho other\n" });
    const response = await fetch(url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(fixture.manifest), other.bundle.archive),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({ error: "archive_digest_mismatch" });
  });

  test("refuses a loop.json whose id names a different loop unless adopt=true", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed("lp_somewhere_else");
    const body = () => uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive);

    const refused = await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: body() });
    expect(refused.status).toBe(409);
    const adopted = await fetch(url(`/v1/loops/${loopId}/versions?adopt=true`), { method: "POST", body: body() });
    expect(adopted.status).toBe(201);
  });

  test("refuses a bundle carrying credential material, even when the client skipped its own scan", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts, keys } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const secret = ["ghp", "_", "A".repeat(30)].join("");

    // Built entry-by-entry rather than from a directory: `collectBundle` would
    // have refused this on the client, and the point is that the SERVER refuses
    // it too — the uploader may be an old CLI, a script, or someone's curl.
    const entries = [
      { path: "loop.json", mode: MODE_DATA, bytes: ownBytes(new TextEncoder().encode(JSON.stringify(definition(loopId)))) },
      { path: "scripts/run.sh", mode: MODE_SCRIPT, bytes: ownBytes(new TextEncoder().encode(`#!/bin/sh\nexport GITHUB_TOKEN=${secret}\n`)) },
    ].sort((a, b) => (a.path < b.path ? -1 : 1));
    const files = manifestFilesFor(entries);
    const tainted = packBundleEntries({ entries, files, bundleDigest: computeBundleDigest(files), unpackedBytes: 0 });
    const manifest = buildManifest({ name: "demo", loopId, version: 0, files, archiveSha256: tainted.archiveSha256 });

    const response = await fetch(url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(manifest), tainted.archive),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; message?: string };
    expect(body.error).toBe("bundle_contains_secret");
    expect(body.message).toContain("scripts/run.sh");
    // The refusal names the path and the offset; it never echoes the value.
    expect(JSON.stringify(body)).not.toContain(secret);
    expect((await storage.listLoopRevisions(loopId)).total).toBe(0);
    expect(keys()).toEqual([]);
  });
});

describe("bundle reads and prompt scoping", () => {
  test("versions list reports the head, the pin and per-revision state", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);
    await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive) });

    const body = (await (await fetch(url(`/v1/loops/${loopId}/versions`))).json()) as {
      latestVersion: number;
      pinnedVersion: number | null;
      versions: Array<{ version: number; state: string; fileCount: number }>;
    };
    expect(body.latestVersion).toBe(1);
    expect(body.pinnedVersion).toBeNull();
    expect(body.versions[0]).toMatchObject({ version: 1, state: "complete" });
    expect(body.versions[0]?.fileCount).toBeGreaterThan(0);
  });

  test("with NO bucket a revision records the local kind and still detects a missing object", async () => {
    // Every other case in this file builds storage with `bucket: "test-bucket"`,
    // so `usesS3` is always true and both the recorded storageKind and the
    // completeness check only ever exercise the s3 branch. This is the
    // no-bucket install: objects are files under a local root, and the
    // complete/incomplete answer has to come from the recorded storage key
    // exactly as it does for a bucket.
    const root = tempDir("loops-artifacts-nobucket-");
    const artifacts = new BundleArtifactStorage({ localRoot: root, env: {} });
    expect(artifacts.usesS3).toBe(false);
    const { storage, loopId } = await newStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);

    const published = await fetch(url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive),
    });
    expect(published.status).toBe(201);

    // Recorded as the local kind, not as an S3 object.
    const revisions = await storage.listLoopRevisions(loopId);
    expect(revisions.revisions[0]).toMatchObject({ version: 1, storageKind: "db" });

    const list = async (): Promise<string> => {
      const body = (await (await fetch(url(`/v1/loops/${loopId}/versions`))).json()) as {
        versions: Array<{ version: number; state: string }>;
      };
      return body.versions[0]!.state;
    };
    expect(await list()).toBe("complete");

    // Delete the local object the revision points at: the row survives, the
    // bytes do not, and that is exactly what "incomplete" means.
    const key = artifacts.placement("tenant-test", "demo", 1).storageKey;
    unlinkSync(join(root, key));
    expect(await artifacts.objectExists(key)).toBe(false);
    expect(await list()).toBe("incomplete");
  });

  test("a key WITHOUT loops:bundle never receives an agent prompt", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const prompt = "the secret operating instructions";
    const fixture = packed(loopId, {
      defOverrides: { target: { type: "agent", provider: "codewith", prompt } },
    });
    const publisher = await createServer(storage, artifacts);
    const uploaded = await fetch(publisher.url(`/v1/loops/${loopId}/versions`), {
      method: "POST",
      body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive),
    });
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({ carriesPrompt: true });

    const reader = await createServer(storage, artifacts, principal(["loops:read", "loops:write"]));
    const detail = await fetch(reader.url(`/v1/loops/${loopId}/versions/1`));
    const text = await detail.text();
    expect(detail.status).toBe(200);
    expect(text).not.toContain(prompt);

    const download = await fetch(reader.url(`/v1/loops/${loopId}/versions/1/bundle`));
    expect(download.status).toBe(403);
    expect(await download.text()).not.toContain(prompt);
  });

  test("a key WITH loops:bundle round-trips the prompt through the archive", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const prompt = "the secret operating instructions";
    const fixture = packed(loopId, { defOverrides: { target: { type: "agent", provider: "codewith", prompt } } });
    const { url } = await createServer(storage, artifacts);
    await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive) });

    const detail = await fetch(url(`/v1/loops/${loopId}/versions/latest`));
    expect(await detail.text()).toContain(prompt);

    const download = await fetch(url(`/v1/loops/${loopId}/versions/1/bundle`));
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zstd");
    expect(download.headers.get("x-loops-bundle-digest")).toBe(fixture.bundle.bundleDigest);
    expect(download.headers.get("x-loops-bundle-version")).toBe("1");
    const { unpackBundle } = await import("../lib/bundle/unpack.js");
    const entries = unpackBundle(new Uint8Array(await download.arrayBuffer()));
    const loopJson = entries.find((entry) => entry.path === "loop.json")!;
    expect(new TextDecoder().decode(loopJson.bytes)).toContain(prompt);
  });

  test("a missing version is a 404, not a 500", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    expect((await fetch(url(`/v1/loops/${loopId}/versions/9`))).status).toBe(404);
    expect((await fetch(url(`/v1/loops/${loopId}/versions/latest`))).status).toBe(404);
  });
});

describe("pin and rollback", () => {
  async function publishTwo() {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const server = await createServer(storage, artifacts);
    const first = packed(loopId, { defOverrides: { maxAttempts: 3, target: { type: "command", command: "scripts/run.sh", args: ["--once"] } } });
    const second = packed(loopId, {
      defOverrides: { maxAttempts: 7, target: { type: "command", command: "scripts/run.sh", args: ["--forever"] } },
      script: "#!/bin/sh\necho v2\n",
    });
    await fetch(server.url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(first.manifest), first.bundle.archive) });
    await fetch(server.url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(second.manifest), second.bundle.archive) });
    return { storage, loopId, ...server };
  }

  test("pins and unpins, refusing a version that does not exist", async () => {
    const { storage, loopId, url } = await publishTwo();
    const pinned = await fetch(url(`/v1/loops/${loopId}/pin`), { method: "POST", body: JSON.stringify({ version: 1 }), headers: { "content-type": "application/json" } });
    expect(await pinned.json()).toMatchObject({ pinnedVersion: 1 });
    expect((await storage.getLoop(loopId))?.bundlePinnedVersion).toBe(1);

    const phantom = await fetch(url(`/v1/loops/${loopId}/pin`), { method: "POST", body: JSON.stringify({ version: 99 }), headers: { "content-type": "application/json" } });
    expect(phantom.status).toBe(404);

    const unpinned = await fetch(url(`/v1/loops/${loopId}/pin`), { method: "POST", body: JSON.stringify({ version: null }), headers: { "content-type": "application/json" } });
    expect(await unpinned.json()).toMatchObject({ pinnedVersion: null });
  });

  test("rollback is forward-only: it appends version 3 pointing at version 1's bytes", async () => {
    const { storage, loopId, url } = await publishTwo();
    const before = await storage.listLoopRevisions(loopId);
    const response = await fetch(url(`/v1/loops/${loopId}/rollback`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, reason: "revert bad flags" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: true, version: 3, rolledBackFrom: 1 });

    const after = await storage.listLoopRevisions(loopId);
    expect(after.total).toBe(before.total + 1);
    const appended = after.revisions.find((revision) => revision.version === 3)!;
    const original = after.revisions.find((revision) => revision.version === 1)!;
    // Nothing in the ledger was rewritten: version 1 is byte-identical, and the
    // new head simply points at the same archive.
    expect(appended.bundleDigest).toBe(original.bundleDigest);
    expect(appended.storageKey).toBe(original.storageKey);
    expect(appended.rolledBackFrom).toBe(1);
    expect(after.revisions.find((revision) => revision.version === 2)?.rolledBackFrom).toBeUndefined();
    // The definition was applied to the live row — including the TARGET, which
    // `updateLoop`'s patch surface cannot express.
    const restored = (await storage.getLoop(loopId))!;
    expect(restored.maxAttempts).toBe(3);
    expect(restored.target).toMatchObject({ command: "scripts/run.sh", args: ["--once"] });
    // Runtime columns come from the live row, never from the bundle.
    expect(restored.createdAt).toBeDefined();
  });

  test("dryRun reports the diff and writes nothing", async () => {
    const { storage, loopId, url } = await publishTwo();
    const before = await storage.listLoopRevisions(loopId);
    const response = await fetch(url(`/v1/loops/${loopId}/rollback`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, dryRun: true }),
    });
    expect(await response.json()).toMatchObject({ applied: false, version: 1 });
    expect((await storage.listLoopRevisions(loopId)).total).toBe(before.total);
  });

  test("rolling back to a version that does not exist is a 404", async () => {
    const { loopId, url } = await publishTwo();
    const response = await fetch(url(`/v1/loops/${loopId}/rollback`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 42 }),
    });
    expect(response.status).toBe(404);
  });
});

describe("GET /v1/bundles", () => {
  test("indexes bundled loops and filters by machine", async () => {
    const { storage, loopId } = await newStorage();
    const { artifacts } = artifactStorage();
    const { url } = await createServer(storage, artifacts);
    const fixture = packed(loopId);
    await fetch(url(`/v1/loops/${loopId}/versions`), { method: "POST", body: uploadForm(serializeBundleManifest(fixture.manifest), fixture.bundle.archive) });

    const all = (await (await fetch(url("/v1/bundles"))).json()) as { bundles: Array<{ bundleName: string; latestVersion: number }>; total: number };
    expect(all.bundles).toHaveLength(1);
    expect(all.bundles[0]).toMatchObject({ bundleName: "demo", latestVersion: 1, loopId });

    const filtered = (await (await fetch(url("/v1/bundles?machine=station99"))).json()) as { bundles: unknown[] };
    expect(filtered.bundles).toHaveLength(0);
  });
});

describe("artifact storage", () => {
  test("refuses to overwrite an existing version object", async () => {
    const store = memoryObjectStore();
    const artifacts = new BundleArtifactStorage({ bucket: "b", store });
    await artifacts.putVersion("t", "demo", 1, new Uint8Array([1, 2, 3]), { schema: "x" });
    await expect(artifacts.putVersion("t", "demo", 1, new Uint8Array([4]), { schema: "x" })).rejects.toThrow(/immutable/);
  });

  test("falls back to a local directory when no bucket is configured", async () => {
    const root = tempDir("loops-artifacts-local-");
    const artifacts = new BundleArtifactStorage({ localRoot: root, env: {} });
    expect(artifacts.usesS3).toBe(false);
    await artifacts.putVersion("t", "demo", 1, new Uint8Array([7, 8, 9]), { schema: "x" });
    const key = artifacts.placement("t", "demo", 1).storageKey;
    expect(Array.from((await artifacts.readArchive(key))!)).toEqual([7, 8, 9]);
  });

  test("refuses to build a key for version 0 or a negative version", () => {
    const artifacts = new BundleArtifactStorage({ bucket: "b", store: memoryObjectStore() });
    expect(() => artifacts.placement("t", "demo", 0)).toThrow(/>= 1/);
  });
});
