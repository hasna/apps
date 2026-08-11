import { createHash } from "node:crypto";

export type VerifyWriteStatus = "match" | "grew" | "shrunk" | "mismatch" | "refused";

export interface VerifyWriteMatch {
  ok: true;
  status: "match";
  authoredBytes: number;
  storedBytes: number;
  deltaBytes: 0;
  hashesEqual: true;
  message: string;
}

export interface VerifyWriteDifference {
  ok: false;
  status: "grew" | "shrunk" | "mismatch";
  authoredBytes: number;
  storedBytes: number;
  deltaBytes: number;
  hashesEqual: false;
  message: string;
}

export interface VerifyWriteRefusal {
  ok: false;
  status: "refused";
  code:
    | "object_id_missing"
    | "object_id_invalid"
    | "object_id_mismatch"
    | "content_missing"
    | "content_invalid";
  message: string;
}

export type VerifyWriteResult = VerifyWriteMatch | VerifyWriteDifference | VerifyWriteRefusal;

export interface VerifyFetchedWriteRequest {
  targetId: string;
  authored: Uint8Array;
  fetched: unknown;
  idPath?: string;
  contentPath?: string;
}

interface PathRead {
  found: boolean;
  value?: unknown;
}

function readPath(value: unknown, path: string): PathRead {
  let current = value;
  for (const segment of path.split(".")) {
    if (!segment || current === null || typeof current !== "object") {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function refused(code: VerifyWriteRefusal["code"], message: string): VerifyWriteRefusal {
  return { ok: false, status: "refused", code, message };
}

/**
 * Compare one fetched object with the caller-authored bytes without returning
 * either body or either digest. Object identity is checked before the stored
 * content path is accessed.
 */
export function verifyFetchedWrite(request: VerifyFetchedWriteRequest): VerifyWriteResult {
  const idRead = readPath(request.fetched, request.idPath ?? "id");
  if (!idRead.found) {
    return refused("object_id_missing", "fetched object ID was missing; stored body NOT rendered");
  }
  if (typeof idRead.value !== "string") {
    return refused("object_id_invalid", "fetched object ID was not a string; stored body NOT rendered");
  }
  if (idRead.value !== request.targetId) {
    return refused(
      "object_id_mismatch",
      "fetched object ID did not equal requested ID; stored body NOT rendered"
    );
  }

  const contentRead = readPath(request.fetched, request.contentPath ?? "body");
  if (!contentRead.found) {
    return refused("content_missing", "stored content field was missing; stored body NOT rendered");
  }
  if (typeof contentRead.value !== "string") {
    return refused("content_invalid", "stored content field was not a string; stored body NOT rendered");
  }

  const authored = Buffer.from(request.authored);
  const stored = Buffer.from(contentRead.value, "utf8");
  const authoredBytes = authored.byteLength;
  const storedBytes = stored.byteLength;
  const deltaBytes = storedBytes - authoredBytes;
  const hashesEqual = sha256(authored) === sha256(stored);

  if (hashesEqual) {
    return {
      ok: true,
      status: "match",
      authoredBytes,
      storedBytes,
      deltaBytes: 0,
      hashesEqual: true,
      message: `fetched object ID equals requested ID; ${authoredBytes} bytes; SHA-256 equal; stored body NOT rendered`
    };
  }

  if (deltaBytes > 0) {
    return {
      ok: false,
      status: "grew",
      authoredBytes,
      storedBytes,
      deltaBytes,
      hashesEqual: false,
      message: `third-party content appended, ${deltaBytes} bytes, NOT rendered`
    };
  }

  if (deltaBytes < 0) {
    return {
      ok: false,
      status: "shrunk",
      authoredBytes,
      storedBytes,
      deltaBytes,
      hashesEqual: false,
      message: "stored content is shorter, NOT rendered"
    };
  }

  return {
    ok: false,
    status: "mismatch",
    authoredBytes,
    storedBytes,
    deltaBytes: 0,
    hashesEqual: false,
    message: "byte length equal but SHA-256 differs; stored body NOT rendered"
  };
}
