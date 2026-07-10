import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, type Digest } from "../src/canonical.js";
import {
  LocalEncryptedObjectStoreV1,
  SelfHostedVersionedObjectStoreV1,
  type VersionedObjectSinkV1,
} from "../src/object-store.js";

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeVersionedSinkV1 implements VersionedObjectSinkV1 {
  readonly objects = new Map<string, { bytes: Uint8Array; version: string; checksum: Digest; kms: string }>();
  corruptHead = false;

  async put(input: Parameters<VersionedObjectSinkV1["put"]>[0]) {
    const version = sha256(`version:${input.key}:${input.checksum_sha256}`);
    this.objects.set(`${input.key}\u0000${version}`, {
      bytes: Uint8Array.from(input.bytes),
      version,
      checksum: input.checksum_sha256,
      kms: input.kms_key_ref,
    });
    return {
      version_id: version,
      checksum_sha256: input.checksum_sha256,
      encryption: "aws:kms" as const,
      kms_key_ref: input.kms_key_ref,
    };
  }

  async head(input: Parameters<VersionedObjectSinkV1["head"]>[0]) {
    const object = this.objects.get(`${input.key}\u0000${input.version_id}`)!;
    return {
      version_id: object.version,
      checksum_sha256: this.corruptHead ? sha256("corrupt") : object.checksum,
      size_bytes: object.bytes.byteLength,
      encryption: "aws:kms" as const,
      kms_key_ref: object.kms,
    };
  }

  async get(input: Parameters<VersionedObjectSinkV1["get"]>[0]): Promise<Uint8Array> {
    const object = this.objects.get(`${input.key}\u0000${input.version_id}`);
    if (object === undefined) throw new Error("missing fake object");
    return Uint8Array.from(object.bytes);
  }
}

describe("encrypted and versioned object persistence", () => {
  test("local objects are private, encrypted, content-addressed, capped, and authenticated", async () => {
    const root = temporaryRoot("sandboxes-objects-");
    const bytes = new TextEncoder().encode("classified checkpoint bytes that must not be plaintext");
    const digest = sha256(bytes);
    const store = new LocalEncryptedObjectStoreV1({
      root,
      key: new Uint8Array(32).fill(41),
      key_version: "test-key-v1",
      allow_unsafe_test_path: true,
      clock: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const input = {
      bytes,
      expected_sha256: digest,
      max_bytes: 1_024,
      retention_until: "2030-02-01T00:00:00.000Z",
      data_class: "restricted" as const,
    };
    const first = await store.put(input);
    const replay = await store.put(input);
    expect(replay).toEqual(first);
    expect(await store.read({
      object_sha256: digest,
      object_version: first.object_version,
      max_bytes: 1_024,
    })).toEqual(bytes);

    const hex = digest.slice("sha256:".length);
    const path = join(root, "objects", "sha256", hex.slice(0, 2), `${hex}.object`);
    const encoded = readFileSync(path);
    expect(encoded.includes(bytes)).toBe(false);
    expect(statSync(path).mode & 0o077).toBe(0);
    await expect(store.put({ ...input, retention_until: "2030-03-01T00:00:00.000Z" }))
      .rejects.toThrow("conflicting bytes or metadata");
    await expect(store.read({
      object_sha256: digest,
      object_version: first.object_version,
      max_bytes: bytes.byteLength - 1,
    })).rejects.toThrow("exceeds the read cap");

    encoded[encoded.length - 1] = encoded[encoded.length - 1]! ^ 1;
    writeFileSync(path, encoded, { mode: 0o600 });
    await expect(store.read({
      object_sha256: digest,
      object_version: first.object_version,
      max_bytes: 1_024,
    })).rejects.toThrow("version does not match");
  });

  test("local object roots reject symlink ancestry", () => {
    const root = temporaryRoot("sandboxes-object-links-");
    const real = join(root, "real");
    mkdirSync(real, { mode: 0o700 });
    const link = join(root, "link");
    symlinkSync(real, link, "dir");
    expect(() => new LocalEncryptedObjectStoreV1({
      root: join(link, "objects"),
      key: new Uint8Array(32).fill(42),
      key_version: "test-key-v1",
      allow_unsafe_test_path: true,
    })).toThrow("ancestry cannot contain symlinks");
  });

  test("self-hosted objects require an exact version, KMS identity, and read-after-write checksum", async () => {
    const sink = new FakeVersionedSinkV1();
    const store = new SelfHostedVersionedObjectStoreV1({
      sink,
      namespace: "sandboxes/runtime",
      kms_key_ref: "kms:alias/sandboxes-test",
      clock: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    const bytes = new TextEncoder().encode("versioned checkpoint content");
    const objectDigest = sha256(bytes);
    const receipt = await store.put({
      bytes,
      expected_sha256: objectDigest,
      max_bytes: 1_024,
      retention_until: "2030-02-01T00:00:00.000Z",
      data_class: "restricted",
    });
    expect(receipt.backend).toBe("self_hosted_versioned");
    expect(await store.read({
      object_sha256: objectDigest,
      object_version: receipt.object_version,
      max_bytes: 1_024,
    })).toEqual(bytes);
    expect("signedUrl" in sink).toBe(false);

    sink.corruptHead = true;
    await expect(store.put({
      bytes: new TextEncoder().encode("different bytes"),
      expected_sha256: sha256("different bytes"),
      max_bytes: 1_024,
      retention_until: "2030-02-01T00:00:00.000Z",
      data_class: "restricted",
    })).rejects.toThrow("read-after-write proof mismatch");
  });
});
