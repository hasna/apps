import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEstateSync, EstateSyncError, isSha256Hex, normalizeName } from "./sync.js";
import { createMemoryS3 } from "./test/memory-s3.js";

const CREDS = { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" };
const SIGNING_KEY = "test-signing-key-that-is-32-bytes-long!!";

function makeClient(prefix = "skills") {
  const { fetch, state } = createMemoryS3();
  const client = createEstateSync({
    bucket: "hasna-apps-prod-store-789877399345",
    prefix,
    region: "us-east-1",
    credentials: CREDS,
    signingKey: SIGNING_KEY,
    fetch,
  });
  return { client, state };
}

describe("estate-sync push", () => {
  test("push writes a digest bundle plus a signed index pointer under the prefix", async () => {
    const { client, state } = makeClient("skills");
    const body = new TextEncoder().encode("hello skill bundle");
    const result = await client.push({ name: "pdf-generate", body });

    expect(result.name).toBe("pdf-generate");
    expect(isSha256Hex(result.digest)).toBe(true);
    expect(result.sizeBytes).toBe(body.byteLength);
    expect(result.bundleKey).toBe(`skills/bundles/${result.digest}`);
    expect(result.indexKey).toBe("skills/index/pdf-generate.json");
    expect(result.bundleAlreadyExisted).toBe(false);

    // bundle object present, addressed by digest
    expect(state.objects.has(result.bundleKey)).toBe(true);
    // index object present and carries a signature
    const indexRaw = new TextDecoder().decode(state.objects.get(result.indexKey)!);
    const index = JSON.parse(indexRaw) as Record<string, unknown>;
    expect(index.digest).toBe(result.digest);
    expect(index.name).toBe("pdf-generate");
    expect(typeof index.signature).toBe("string");
    expect(index.signingKeyId).toBe("v1");
    // no object escaped the prefix
    for (const key of state.objects.keys()) expect(key.startsWith("skills/")).toBe(true);
  });

  test("pushing identical bytes is a content-addressed no-op for the bundle", async () => {
    const { client, state } = makeClient("loops");
    const body = new TextEncoder().encode("loop def v1");
    const first = await client.push({ name: "watch", body });
    const putCountAfterFirst = state.putCount;
    const second = await client.push({ name: "watch", body });
    expect(second.digest).toBe(first.digest);
    expect(second.bundleAlreadyExisted).toBe(true);
    // exactly one bundle PUT, one index PUT on the second push
    expect(state.putCount).toBe(putCountAfterFirst + 1);
  });

  test("push rejects names that would escape the prefix tenant", async () => {
    const { client } = makeClient("skills");
    await expect(client.push({ name: "../escape", body: new TextEncoder().encode("x") })).rejects.toThrow("Invalid artifact name");
  });
});

describe("estate-sync pull", () => {
  test("pull resolves the signed index, fetches by digest, verifies sha256, hydrates atomically", async () => {
    const { client, state } = makeClient("skills");
    const bytes = new TextEncoder().encode("verified bundle content");
    const pushed = await client.push({ name: "pdf-generate", body: bytes });

    const tmpDir = mkdtempSync(join(tmpdir(), "estate-sync-test-"));
    const target = join(tmpDir, "bundle.bin");
    try {
      const pulled = await client.pull({ name: "pdf-generate", hydrateTo: target });
      expect(pulled.digest).toBe(pushed.digest);
      expect(pulled.sizeBytes).toBe(bytes.byteLength);
      expect(pulled.signatureVerified).toBe(true);
      expect(pulled.hydratedTo).toBe(target);
      // hydrated bytes match and verify against the digest
      const hydrated = new Uint8Array(readFileSync(target));
      expect(hydrated).toEqual(bytes);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a corrupted bundle is rejected with a digest mismatch", async () => {
    const { client, state } = makeClient("skills");
    await client.push({ name: "pdf-generate", body: new TextEncoder().encode("original bytes") });
    // Corrupt the bundle object after the push: the index still names the old digest.
    const keys = [...state.objects.keys()].filter((k) => k.includes("/bundles/"));
    expect(keys).toHaveLength(1);
    state.objects.set(keys[0]!, new TextEncoder().encode("tampered bytes"));
    await expect(client.pull({ name: "pdf-generate" })).rejects.toThrow("BUNDLE_DIGEST_MISMATCH");
  });

  test("a missing index reads as absent and pull fails fail-closed", async () => {
    const { client } = makeClient("skills");
    await expect(client.pull({ name: "does-not-exist" })).rejects.toThrow("INDEX_MISSING");
  });

  test("a tampered index signature is rejected when requireSignature is set", async () => {
    const { client, state } = makeClient("skills");
    await client.push({ name: "pdf-generate", body: new TextEncoder().encode("signed bytes") });
    const indexKey = "skills/index/pdf-generate.json";
    const index = JSON.parse(new TextDecoder().decode(state.objects.get(indexKey)!)) as Record<string, unknown>;
    index.signature = "0".repeat(64);
    state.objects.set(indexKey, new TextEncoder().encode(JSON.stringify(index)));
    await expect(client.pull({ name: "pdf-generate", requireSignature: true })).rejects.toThrow("INDEX_SIGNATURE_INVALID");
  });

  test("a puller without a signing key records signatureNotChecked but still verifies sha256", async () => {
    const { fetch, state } = createMemoryS3();
    const pushing = createEstateSync({
      bucket: "hasna-apps-prod-store-789877399345",
      prefix: "skills",
      credentials: CREDS,
      signingKey: SIGNING_KEY,
      fetch,
    });
    await pushing.push({ name: "pdf-generate", body: new TextEncoder().encode("signed by publisher") });

    const pulling = createEstateSync({
      bucket: "hasna-apps-prod-store-789877399345",
      prefix: "skills",
      credentials: CREDS,
      fetch,
    });
    const result = await pulling.pull({ name: "pdf-generate" });
    expect(result.signatureNotChecked).toBe(true);
    expect(result.signatureVerified).toBe(false);
    expect(new TextDecoder().decode(result.bytes)).toBe("signed by publisher");
    void state;
  });

  test("pull hydrates atomically: no residue temp file survives a successful hydrate", async () => {
    const { client } = makeClient("skills");
    await client.push({ name: "pdf-generate", body: new TextEncoder().encode("atomic bytes") });
    const tmpDir = mkdtempSync(join(tmpdir(), "estate-sync-atomic-"));
    const target = join(tmpDir, "out.bin");
    try {
      await client.pull({ name: "pdf-generate", hydrateTo: target });
      expect(existsSync(target)).toBe(true);
      // no .tmp- residue left behind
      expect(existsSync(join(tmpDir, "out.bin"))).toBe(true);
      expect(readdirSync(tmpDir).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("estate-sync names", () => {
  test("normalizeName accepts safe names and rejects path/control characters", () => {
    expect(normalizeName("pdf-generate")).toBe("pdf-generate");
    expect(normalizeName("a.b_c-d")).toBe("a.b_c-d");
    expect(() => normalizeName("../x")).toThrow("Invalid artifact name");
    expect(() => normalizeName("a/b")).toThrow("Invalid artifact name");
    expect(() => normalizeName("")).toThrow("Invalid artifact name");
  });

  test("EstateSyncError carries a stable code", () => {
    const error = new EstateSyncError("boom", "TEST_CODE");
    expect(error.code).toBe("TEST_CODE");
    expect(error.message).toBe("[TEST_CODE] boom");
  });
});
