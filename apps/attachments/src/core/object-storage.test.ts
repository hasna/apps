// Test-gap remediation: agent-authored (SOL consult refused — model at capacity).
// Covers src/core/object-storage.ts, which had NO direct tests: parseRangeHeader
// (byte-range edge cases) and LocalObjectStore (real upload/getStream/delete
// against a temp local dir). Elsewhere in the suite these are only mocked.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Transform } from "stream";
import { LocalObjectStore, parseRangeHeader, resolveLocalObjectPath } from "./object-storage";
import { normalizeConfig } from "./config";

function makeLocalConfig(dir: string) {
  return normalizeConfig({ storage: { backend: "local", localDir: dir, maxSizeBytes: 1_000_000 } });
}

describe("parseRangeHeader", () => {
  const SIZE = 100;

  test("returns null for no header or empty header", () => {
    expect(parseRangeHeader(null, SIZE)).toBeNull();
    expect(parseRangeHeader(undefined, SIZE)).toBeNull();
    expect(parseRangeHeader("", SIZE)).toBeNull();
  });

  test("returns null for malformed headers", () => {
    expect(parseRangeHeader("bytes=5", SIZE)).toBeNull(); // no dash
    expect(parseRangeHeader("bytes=-", SIZE)).toBeNull(); // empty both sides
    expect(parseRangeHeader("bytes=", SIZE)).toBeNull();
    expect(parseRangeHeader("items=0-5", SIZE)).toBeNull(); // wrong unit
    expect(parseRangeHeader("bytes=abc", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=1.5-2", SIZE)).toBeNull(); // non-integer
    expect(parseRangeHeader("bytes=-1.5", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes= -5", SIZE)).toBeNull(); // space inside
  });

  test("parses a closed range", () => {
    expect(parseRangeHeader("bytes=0-5", SIZE)).toEqual({ start: 0, end: 5 });
    expect(parseRangeHeader("bytes=50-99", SIZE)).toEqual({ start: 50, end: 99 });
  });

  test("parses an open-ended range with no end", () => {
    expect(parseRangeHeader("bytes=50-", SIZE)).toEqual({ start: 50, end: undefined });
    expect(parseRangeHeader("bytes=0-", SIZE)).toEqual({ start: 0, end: undefined });
  });

  test("parses a suffix range", () => {
    expect(parseRangeHeader("bytes=-20", SIZE)).toEqual({ start: 80, end: 99 });
    expect(parseRangeHeader("bytes=-100", SIZE)).toEqual({ start: 0, end: 99 });
  });

  test("clamps an over-long suffix to the whole file", () => {
    expect(parseRangeHeader("bytes=-150", SIZE)).toEqual({ start: 0, end: 99 });
  });

  test("rejects a zero or negative suffix length", () => {
    expect(parseRangeHeader("bytes=-0", SIZE)).toBeNull();
  });

  test("clamps an end beyond the file size", () => {
    expect(parseRangeHeader("bytes=90-999", SIZE)).toEqual({ start: 90, end: 99 });
  });

  test("rejects a start at or beyond the file size", () => {
    expect(parseRangeHeader("bytes=100-", SIZE)).toBeNull();
    expect(parseRangeHeader("bytes=200-300", SIZE)).toBeNull();
  });

  test("rejects an end before the start", () => {
    expect(parseRangeHeader("bytes=50-10", SIZE)).toBeNull();
  });

  test("rejects a negative start", () => {
    expect(parseRangeHeader("bytes=-5-10", SIZE)).toBeNull();
  });
});

describe("LocalObjectStore", () => {
  let dir: string;
  let store: LocalObjectStore;

  beforeEach(() => {
    dir = join(tmpdir(), `attachments-object-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    store = new LocalObjectStore(makeLocalConfig(dir));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  test("uploadBuffer then getStream returns full body with status 200 and exact length", async () => {
    const body = Buffer.from("hello world");
    await store.uploadBuffer("attachments/k.txt", body, "text/plain");
    const result = store.getStream("attachments/k.txt", "text/plain");
    expect(result.status).toBe(200);
    expect(result.contentLength).toBe(body.length);
    expect(result.contentRange).toBeUndefined();
    expect(result.contentType).toBe("text/plain");
    expect(await collect(result.body)).toEqual(body);
  });

  test("getStream with a range returns 206, exact slice, and correct content-range", async () => {
    const body = Buffer.from("0123456789");
    await store.uploadBuffer("attachments/k.txt", body, "text/plain");
    const result = store.getStream("attachments/k.txt", "text/plain", { start: 2, end: 5 });
    expect(result.status).toBe(206);
    expect(result.contentLength).toBe(4);
    expect(result.contentRange).toBe("bytes 2-5/10");
    expect(await collect(result.body)).toEqual(Buffer.from("2345"));
  });

  test("getStream with an open-ended range runs to the end of the file", async () => {
    const body = Buffer.from("0123456789");
    await store.uploadBuffer("attachments/k.txt", body, "text/plain");
    const result = store.getStream("attachments/k.txt", "text/plain", { start: 8 });
    expect(result.status).toBe(206);
    expect(result.contentRange).toBe("bytes 8-9/10");
    expect(await collect(result.body)).toEqual(Buffer.from("89"));
  });

  test("uploadFile pipes the source file through the transform option", async () => {
    const src = join(dir, "src.txt");
    writeFileSync(src, "abcdef");
    const upper = new Transform({
      transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, out?: Buffer) => void) {
        cb(null, Buffer.from(String(chunk).toUpperCase()));
      },
    });
    // The transform contract is `(input) => transformed` — it must pipe the
    // input through (same shape as upload.ts's encryption transform).
    await store.uploadFile("attachments/up.txt", src, "text/plain", { transform: (input) => input.pipe(upper) });
    expect(readFileSync(resolveLocalObjectPath(makeLocalConfig(dir), "attachments/up.txt"))).toEqual(
      Buffer.from("ABCDEF"),
    );
  });

  test("downloadToFile copies the object and returns its size", async () => {
    await store.uploadBuffer("attachments/dl.bin", Buffer.from("0123456789"), "application/octet-stream");
    const dest = join(dir, "out", "dl.bin");
    const size = await store.downloadToFile("attachments/dl.bin", dest);
    expect(size).toBe(10);
    expect(readFileSync(dest)).toEqual(Buffer.from("0123456789"));
  });

  test("delete removes the object; deleting a missing object is a no-op", async () => {
    await store.uploadBuffer("attachments/del.txt", Buffer.from("x"), "text/plain");
    const path = resolveLocalObjectPath(makeLocalConfig(dir), "attachments/del.txt");
    expect(existsSync(path)).toBe(true);
    await store.delete("attachments/del.txt");
    expect(existsSync(path)).toBe(false);
    await expect(store.delete("attachments/never-existed.txt")).resolves.toBeUndefined();
  });
});
