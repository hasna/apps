import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readPackedRegularFiles, scanPackedArchive } from "./public-release-archive.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeField(header: Uint8Array, offset: number, length: number, value: string): void {
  header.set(new TextEncoder().encode(value).subarray(0, length), offset);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarEntry(path: string, bytes: Uint8Array, type = "0"): Uint8Array {
  const header = new Uint8Array(512);
  writeField(header, 0, 100, path);
  writeField(header, 100, 8, octal(type === "5" ? 0o755 : 0o644, 8));
  writeField(header, 108, 8, octal(0, 8));
  writeField(header, 116, 8, octal(0, 8));
  writeField(header, 124, 12, octal(bytes.byteLength, 12));
  writeField(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeField(header, 257, 6, "ustar\0");
  writeField(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padded = Math.ceil(bytes.byteLength / 512) * 512;
  const entry = new Uint8Array(512 + padded);
  entry.set(header);
  entry.set(bytes, 512);
  return entry;
}

function fixture(entries: Array<{ path: string; bytes: Uint8Array; type?: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "todos-packed-release-"));
  temporaryRoots.push(root);
  const chunks = [
    ...entries.map((entry) => tarEntry(entry.path, entry.bytes, entry.type)),
    new Uint8Array(1024),
  ];
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const path = join(root, "fixture.tgz");
  writeFileSync(path, gzipSync(tar));
  return path;
}

function validReadme(): { path: string; bytes: Uint8Array } {
  return { path: "package/README.md", bytes: new TextEncoder().encode("bun install -g @hasna/todos\n") };
}

function paxRecord(key: string, value: string): Uint8Array {
  const body = `${key}=${value}\n`;
  let length = body.length + 2;
  while (`${length} ${body}`.length !== length) length = `${length} ${body}`.length;
  return new TextEncoder().encode(`${length} ${body}`);
}

describe("packed public release byte scanner", () => {
  test("treats generic assignment heuristics as non-terminal without weakening high-confidence scans", () => {
    const genericArchive = fixture([
      validReadme(),
      {
        path: "package/dist/index.js",
        bytes: new TextEncoder().encode("api_key = runtimeConfigurationValue\n"),
      },
    ]);
    expect(scanPackedArchive(genericArchive)).toEqual([]);

    const token = ["gh", "p_", "SyntheticArchiveConfidenceFixture1234567890"].join("");
    const highConfidenceArchive = fixture([
      validReadme(),
      { path: "package/dist/index.js", bytes: new TextEncoder().encode(token) },
    ]);
    expect(scanPackedArchive(highConfidenceArchive).some((failure) =>
      failure.check === "secret-scan" && failure.message.includes("github_pat")
    )).toBe(true);
  });

  test("scans extensionless regular files", () => {
    const token = ["npm", "_", "SyntheticExtensionlessFixtureValue1234567890"].join("");
    const archive = fixture([
      validReadme(),
      { path: "package/dist/opaque", bytes: new TextEncoder().encode(token) },
    ]);

    const failures = scanPackedArchive(archive);
    expect(failures.some((failure) => failure.check === "secret-scan" && failure.message.includes("package/dist/opaque"))).toBe(true);
    expect(JSON.stringify(failures)).not.toContain(token.slice(0, 12));
  });

  test("scans renamed binary files through byte-preserving projections", () => {
    const token = ["gh", "p_", "SyntheticRenamedBinaryFixtureValue1234567890"].join("");
    const bytes = new Uint8Array([0, 0xff, ...new TextEncoder().encode(token), 0, 1]);
    const archive = fixture([validReadme(), { path: "package/dist/image.png", bytes }]);

    const failures = scanPackedArchive(archive);
    expect(failures.some((failure) => failure.check === "secret-scan" && failure.message.includes("image.png"))).toBe(true);
  });

  test("cannot hide a credential-like value behind interleaved binary controls", () => {
    const token = ["npm", "_", "SyntheticInterleavedBinaryFixtureValue1234567890"].join("");
    const bytes = new Uint8Array([...new TextEncoder().encode(token)].flatMap((byte) => [byte, 0x01]));
    const archive = fixture([validReadme(), { path: "package/dist/renamed.dat", bytes }]);

    const failures = scanPackedArchive(archive);
    expect(failures.some((failure) => failure.check === "secret-scan" && failure.message.includes("#compact-ascii"))).toBe(true);
  });

  test("cannot dilute one credential-splitting control byte with text padding", () => {
    const token = ["npm", "_", "SyntheticSparseControlFixtureValue1234567890"].join("");
    const tokenBytes = new TextEncoder().encode(token);
    const bytes = new Uint8Array(16_384 + tokenBytes.byteLength + 1);
    bytes.fill(0x20);
    bytes.set(tokenBytes.subarray(0, 9), 8_192);
    bytes[8_201] = 0x01;
    bytes.set(tokenBytes.subarray(9), 8_202);
    const archive = fixture([validReadme(), { path: "package/dist/padded.txt", bytes }]);

    const failures = scanPackedArchive(archive);
    expect(failures.some((failure) => failure.check === "secret-scan" && failure.message.includes("#compact-ascii"))).toBe(true);
  });

  test("fails closed on corrupt headers instead of skipping unreadable entries", () => {
    const archive = fixture([validReadme()]);
    const bytes = readFileBytes(archive);
    bytes[20] ^= 0xff;
    writeFileSync(archive, bytes);

    expect(scanPackedArchive(archive).map((failure) => failure.check)).toContain("pack-archive");
  });

  test("rejects traversal, duplicate, and special entries", () => {
    const traversal = fixture([validReadme(), { path: "../outside", bytes: new Uint8Array() }]);
    const duplicate = fixture([validReadme(), validReadme()]);
    const symlink = fixture([validReadme(), { path: "package/dist/link", bytes: new Uint8Array(), type: "2" }]);

    for (const archive of [traversal, duplicate, symlink]) {
      expect(scanPackedArchive(archive).map((failure) => failure.check)).toContain("pack-archive");
    }
  });

  test("rejects regular-file parent collisions and non-canonical PAX sizes", () => {
    const parentCollision = fixture([
      validReadme(),
      { path: "package/dist", bytes: new Uint8Array() },
      { path: "package/dist/child", bytes: new Uint8Array() },
    ]);
    const nonCanonicalPax = fixture([
      { path: "pax-size", bytes: paxRecord("size", "1e1"), type: "x" },
      validReadme(),
    ]);

    for (const archive of [parentCollision, nonCanonicalPax]) {
      expect(scanPackedArchive(archive).map((failure) => failure.check)).toContain("pack-archive");
    }
  });

  test("fails closed when the packed archive cannot be read", () => {
    expect(scanPackedArchive("/tmp/todos-stage-a-definitely-missing-archive.tgz").map((failure) => failure.check)).toContain("pack-archive");
  });

  test("fails closed when explicit archive bounds are exceeded", () => {
    const archive = fixture([validReadme(), { path: "package/dist/data", bytes: new Uint8Array(32) }]);
    expect(() => readPackedRegularFiles(archive, { maxFileBytes: 16 })).toThrow(/exceeds 16 bytes/);
  });

  test("rejects symlinks and oversized sparse archives before reading bytes", () => {
    const archive = fixture([validReadme()]);
    const root = mkdtempSync(join(tmpdir(), "todos-packed-input-"));
    temporaryRoots.push(root);
    const link = join(root, "archive-link.tgz");
    const sparse = join(root, "oversized-sparse.tgz");
    symlinkSync(archive, link);
    writeFileSync(sparse, new Uint8Array());
    truncateSync(sparse, 1024 * 1024);

    expect(() => readPackedRegularFiles(link)).toThrow(/regular file|symlink/i);
    expect(() => readPackedRegularFiles(sparse, { maxCompressedBytes: 64 }))
      .toThrow(/exceeds 64 compressed bytes/);
  });
});

function readFileBytes(path: string): Uint8Array {
  return readFileSync(path);
}
