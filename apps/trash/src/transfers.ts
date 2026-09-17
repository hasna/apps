import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, MAX_CAPSULE_BYTES } from "./api/domain.js";
import type { TransferGrant } from "./api/objects.js";
import { inspectCapsuleStream, inspectOpenCapsule, type CapsuleReceipt } from "./capsule.js";
import { inspectAncestors } from "./lib/inspect.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class TrashTransferError extends Error {
  constructor(readonly code: string) {
    super("Trash payload transfer or verification failed; retain the source and any partial capsule for recovery.");
    this.name = "TrashTransferError";
  }
}
const allowedHeaders = new Set(["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256", "x-amz-server-side-encryption"]);
function validateGrant(grant: TransferGrant, method: "PUT" | "GET", expected: CapsuleReceipt) {
  try {
    const url = new URL(grant.url);
    if (grant.url.length > 16 * 1024 || url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !/^(?:[a-z0-9][a-z0-9.-]*\.)?s3[.-][a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(url.hostname) || !url.searchParams.has("X-Amz-Signature") || grant.method !== method) throw new Error();
    const until = Date.parse(grant.expiresAt);
    if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 600_000) throw new Error();
    if (!Number.isSafeInteger(expected.artifact.sizeBytes) || expected.artifact.sizeBytes < 12 || expected.artifact.sizeBytes > MAX_CAPSULE_BYTES || !/^[a-f0-9]{64}$/.test(expected.artifact.sha256)) throw new Error();
    const headers = new Headers();
    for (const [name, value] of Object.entries(grant.headers)) {
      const lower = name.toLowerCase();
      if (!allowedHeaders.has(lower) || headers.has(lower) || typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
      headers.set(lower, value);
    }
    if (method === "GET" && [...headers].length) throw new Error();
    if (method === "PUT" && (
      headers.get("content-length") !== String(expected.artifact.sizeBytes) || headers.get("content-type") !== "application/octet-stream" ||
      headers.get("if-none-match") !== "*" || headers.get("x-amz-server-side-encryption") !== "AES256" ||
      headers.get("x-amz-checksum-sha256") !== Buffer.from(expected.artifact.sha256, "hex").toString("base64")
    )) throw new Error();
    return headers;
  } catch { throw new TrashTransferError("invalid_transfer_grant"); }
}
function ancestors(path: string) { if (inspectAncestors(path).length) throw new TrashTransferError("unsafe_transfer_path"); }

/** Never forwards API credentials; only the reviewed object grant's fixed header set. */
export async function uploadCapsule(grant: TransferGrant, path: string, expected: CapsuleReceipt, request: Fetcher = fetch): Promise<{ status: "uploaded" | "existing" }> {
  const headers = validateGrant(grant, "PUT", expected); const absolute = resolve(path); ancestors(absolute);
  let fd: number | undefined;
  try {
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (canonicalJson(inspectOpenCapsule(fd)) !== canonicalJson(expected)) throw new TrashTransferError("capsule_mismatch");
    const response = await request(grant.url, { method: "PUT", headers, body: Bun.file(fd), redirect: "error", signal: AbortSignal.timeout(240_000) });
    void response.body?.cancel().catch(() => {});
    // A lost PUT response can be reconciled by the subsequent full server verification.
    if (response.status === 412) return { status: "existing" };
    if (response.status !== 200) throw new TrashTransferError("upload_failed");
    return { status: "uploaded" };
  } catch (error) { if (error instanceof TrashTransferError) throw error; throw new TrashTransferError("upload_failed"); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Failed downloads preserve the exclusive partial file; an existing path is never overwritten. */
export async function downloadCapsule(grant: TransferGrant, path: string, expected: CapsuleReceipt, request: Fetcher = fetch): Promise<void> {
  const headers = validateGrant(grant, "GET", expected); const absolute = resolve(path); ancestors(absolute);
  let fd: number | undefined;
  try {
    fd = openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const response = await request(grant.url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (response.status !== 200 || !response.body) { void response.body?.cancel().catch(() => {}); throw new TrashTransferError("download_failed"); }
    let written = 0;
    const recorded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      written += chunk.length;
      if (written > expected.artifact.sizeBytes) throw new TrashTransferError("download_too_large");
      let offset = 0;
      while (offset < chunk.length) {
        const size = writeSync(fd!, chunk, offset, chunk.length - offset);
        if (!size) throw new TrashTransferError("download_write_failed");
        offset += size;
      }
      controller.enqueue(chunk);
    } }));
    const actual = await inspectCapsuleStream(recorded, expected.artifact.sizeBytes);
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new TrashTransferError("capsule_mismatch");
    fsyncSync(fd);
  } catch (error) { if (error instanceof TrashTransferError) throw error; throw new TrashTransferError("download_failed"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
