import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCapsule } from "./capsule.js";
import { downloadCapsule, uploadCapsule } from "./transfers.js";
import type { TransferGrant } from "./api/objects.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-transfer-"))); roots.push(root);
  writeFileSync(join(root, "source"), "private selected bytes\n");
  const capsule = join(root, "capsule"); const receipt = createCapsule(join(root, "source"), capsule);
  const grant: TransferGrant = { url: "https://fixture-bucket.s3.us-east-1.amazonaws.com/trash/fixture?X-Amz-Signature=fixture", method: "GET", headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  return { root, capsule, receipt, grant };
}

test("download streams into an exclusive owner-only capsule and verifies the full receipt", async () => {
  const { root, capsule, receipt, grant } = fixture(); const target = join(root, "downloaded");
  await downloadCapsule(grant, target, receipt, async (_url, init) => {
    expect(new Headers(init?.headers).has("authorization")).toBe(false); expect(init?.redirect).toBe("error");
    return new Response(readFileSync(capsule));
  });
  expect(readFileSync(target)).toEqual(readFileSync(capsule));
  await expect(downloadCapsule(grant, target, receipt, async () => new Response(readFileSync(capsule)))).rejects.toThrow();
});

test("corrupt and oversized downloads fail with a retained partial file and a redacted diagnostic", async () => {
  const { root, capsule, receipt, grant } = fixture(); const data = readFileSync(capsule); data[data.length - 1] ^= 1;
  const target = join(root, "corrupt");
  await expect(downloadCapsule(grant, target, receipt, async () => new Response(data))).rejects.toThrow("verification");
  expect(existsSync(target)).toBe(true);
  await expect(downloadCapsule(grant, join(root, "large"), receipt, async () => new Response(Buffer.alloc(receipt.artifact.sizeBytes + 1)))).rejects.toThrow();
});

test("transfer authorities, headers, expired grants and redirects are refused", async () => {
  const { root, receipt, grant } = fixture(); let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test" } }); };
  for (const change of [
    { url: "http://fixture-bucket.s3.us-east-1.amazonaws.com/object" }, { url: "https://api.hasna.com/trash/v1" },
    { url: "https://user:password@fixture-bucket.s3.us-east-1.amazonaws.com/object" }, { headers: { authorization: "forbidden" } },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
  ]) await expect(downloadCapsule({ ...grant, ...change }, join(root, "refused"), receipt, fetcher)).rejects.toThrow();
  expect(calls).toBe(0); expect(existsSync(join(root, "refused"))).toBe(false);
  await expect(downloadCapsule(grant, join(root, "redirect"), receipt, fetcher)).rejects.toThrow();
  expect(calls).toBe(1);
});

test("upload verifies a capsule before delivering it and forwards only signed object headers", async () => {
  const { capsule, receipt, grant } = fixture(); let calls = 0;
  const upload = { ...grant, method: "PUT" as const, headers: { "content-type": "application/octet-stream", "content-length": String(receipt.artifact.sizeBytes), "if-none-match": "*", "x-amz-checksum-sha256": Buffer.from(receipt.artifact.sha256, "hex").toString("base64"), "x-amz-server-side-encryption": "AES256" } };
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls++; expect(init?.method).toBe("PUT"); expect(init?.redirect).toBe("error");
    expect(Buffer.from(await new Response(init?.body).arrayBuffer())).toEqual(readFileSync(capsule));
    return new Response(null, { status: 200 });
  };
  await uploadCapsule(upload, capsule, receipt, fetcher);
  expect(calls).toBe(1);
  writeFileSync(capsule, "damaged");
  await expect(uploadCapsule(upload, capsule, receipt, fetcher)).rejects.toThrow();
  expect(calls).toBe(1);
});
