import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3Objects } from "./s3.js";
import { createCapsule } from "../capsule.js";
import type { Entry } from "./domain.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-s3-test-")));
  writeFileSync(join(root, "source"), "object proof\n"); const receipt = createCapsule(join(root, "source"), join(root, "capsule"));
  const bytes = readFileSync(join(root, "capsule")); rmSync(root, { recursive: true, force: true });
  const id = randomUUID();
  const entry: Entry = { ...receipt, id, stationId: randomUUID(), stationName: "station-test", originalPath: "/fixture", agent: { name: "proof", harness: null, session: null },
    retentionDays: 90, version: 1, state: "uploading", capturedAt: new Date().toISOString(), expiresAt: null, held: false, backup: "none", objectKey: `trash/${"a".repeat(64)}/${id}`, objectVersion: null };
  return { entry, bytes, receipt };
}
function fakeClient(send: (command: any) => Promise<any>) { return { send } as S3Client; }
const config = { bucket: "trash-fixture-bucket", region: "us-east-1" };

test("S3 verification pins and validates a complete exact object version", async () => {
  const { entry, bytes, receipt } = fixture(); const commands: any[] = [];
  const client = fakeClient(async (command) => {
    commands.push(command);
    const metadata = { VersionId: "fixture-version", ContentLength: bytes.length, ChecksumSHA256: Buffer.from(receipt.artifact.sha256, "hex").toString("base64") };
    return command.constructor.name === "GetObjectCommand" ? { ...metadata, Body: { transformToWebStream: () => new Blob([bytes]).stream() } } : metadata;
  });
  expect(await createS3Objects(config, client).verify(entry)).toEqual({ version: "fixture-version", receipt });
  expect(commands.map((c) => c.constructor.name)).toEqual(["HeadObjectCommand", "GetObjectCommand"]);
  expect(commands[1].input.VersionId).toBe("fixture-version");
});

test("S3 verification rejects absent version IDs, wrong sizes, wrong checksums and corrupt bodies", async () => {
  const { entry, bytes } = fixture();
  const metadata = { VersionId: "version", ContentLength: bytes.length, ChecksumSHA256: Buffer.from(entry.artifact.sha256, "hex").toString("base64") };
  for (const overrides of [{ VersionId: undefined }, { VersionId: "null" }, { ContentLength: bytes.length + 1 }, { ChecksumSHA256: "mismatch" }]) {
    const objects = createS3Objects(config, fakeClient(async () => ({ ...metadata, ...overrides })));
    await expect(objects.verify(entry)).rejects.toThrow();
  }
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  const objects = createS3Objects(config, fakeClient(async () => ({ ...metadata, Body: { transformToWebStream: () => new Blob([corrupt]).stream() } })));
  await expect(objects.verify(entry)).rejects.toThrow();
});

test("reverification reads the recorded version even when the current object changes", async () => {
  const { entry, bytes, receipt } = fixture(); const versions: unknown[] = [];
  const objects = createS3Objects(config, fakeClient(async (command) => {
    versions.push(command.input.VersionId);
    return { VersionId: command.input.VersionId ?? "different-current-version", ContentLength: bytes.length,
      ChecksumSHA256: Buffer.from(receipt.artifact.sha256, "hex").toString("base64"), Body: { transformToWebStream: () => new Blob([bytes]).stream() } };
  }));
  expect((await objects.verify({ ...entry, objectVersion: "recorded-version" })).version).toBe("recorded-version");
  expect(versions).toEqual(["recorded-version", "recorded-version"]);
});

test("upload grants sign exclusive creation, exact length, checksum and encryption", async () => {
  const { entry } = fixture();
  const client = new S3Client({ region: config.region, credentials: { accessKeyId: randomBytes(12).toString("hex"), secretAccessKey: randomBytes(32).toString("hex") } });
  try {
    const grant = await createS3Objects(config, client).upload(entry); const url = new URL(grant.url);
    expect(url.protocol).toBe("https:"); expect(url.hostname).toBe("trash-fixture-bucket.s3.us-east-1.amazonaws.com");
    const signed = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    for (const header of ["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256", "x-amz-server-side-encryption"]) expect(signed).toContain(header);
    expect(grant.headers["if-none-match"]).toBe("*");
    expect(grant.headers["content-length"]).toBe(String(entry.artifact.sizeBytes));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  } finally { client.destroy(); }
});

test("readiness refuses unversioned buckets and lifecycle rules that bypass holds", async () => {
  for (const mode of ["unversioned", "expiration", "noncurrent"]) {
    const objects = createS3Objects(config, fakeClient(async (command) => {
      if (command.constructor.name === "GetBucketVersioningCommand") return { Status: mode === "unversioned" ? "Suspended" : "Enabled" };
      if (command.constructor.name === "GetBucketLifecycleConfigurationCommand") return { Rules: [{ Status: "Enabled", ...(mode === "expiration" ? { Expiration: { Days: 90 } } : { NoncurrentVersionExpiration: { NoncurrentDays: 90 } }) }] };
      return {};
    }));
    await expect(objects.ready()).rejects.toThrow();
  }
});

test("deletion uses only an exact version and verifies that version is absent", async () => {
  const { entry } = fixture(); const commands: any[] = [];
  const objects = createS3Objects(config, fakeClient(async (command) => { commands.push(command); if (command.constructor.name === "HeadObjectCommand") throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }); return {}; }));
  await expect(objects.remove(entry)).rejects.toThrow();
  expect(commands.length).toBe(0);
  await objects.remove({ ...entry, objectVersion: "exact-version" });
  expect(commands.map((c) => c.input.VersionId)).toEqual(["exact-version", "exact-version"]);
  await expect(objects.remove({ ...entry, objectVersion: "exact-version", objectKey: "some/other/app" })).rejects.toThrow();
});
