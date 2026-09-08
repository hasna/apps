import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { getEventListeners } from "node:events";
useDefaultTestTimeout();
import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSkillBundle, packSkillBundle, sha256Hex, SkillBundleInspectionError, type SkillBundleInspectionErrorCode, SKILL_BUNDLE_INSPECTION_LIMITS } from "./skill-bundle.js";

const encoder = new TextEncoder();
function checksum(header: Uint8Array): void {
  header.fill(32, 148, 156);
  const sum = header.reduce((n, b) => n + b, 0);
  header.set(encoder.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
}
function entry(path = "SKILL.md", body = encoder.encode("# Safe fixture\n"), edit?: (header: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(512 + Math.ceil(body.length / 512) * 512);
  const h = bytes.subarray(0, 512);
  h.set(encoder.encode(path));
  h.set(encoder.encode("0000644\0"), 100);
  h.set(encoder.encode("0000000\0"), 108); h.set(encoder.encode("0000000\0"), 116);
  h.set(encoder.encode(body.length.toString(8).padStart(11, "0") + "\0"), 124);
  h.set(encoder.encode("00000000000\0"), 136);
  h[156] = 48; h.set(encoder.encode("ustar\0" + "00"), 257);
  edit?.(h); checksum(h); bytes.set(body, 512);
  return bytes;
}
function merge(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const tar = (...entries: Uint8Array[]) => merge(...entries, new Uint8Array(1024));
const bundle = (...entries: Uint8Array[]) => gzipSync(tar(...entries));
async function refuses(bytes: Uint8Array, code: SkillBundleInspectionErrorCode = "BUNDLE_INVALID", options: Parameters<typeof inspectSkillBundle>[1] = {}): Promise<void> {
  let caught: unknown;
  try { await inspectSkillBundle(bytes, options); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(SkillBundleInspectionError);
  expect((caught as SkillBundleInspectionError).code).toBe(code);
}

describe("bounded bundle inspection", () => {
  test("canonical pack remains byte-identical and entries own disjoint buffers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-inspection-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "# Safe fixture\n");
      writeFileSync(join(dir, "empty.txt"), "");
      const first = packSkillBundle(dir); const second = packSkillBundle(dir);
      expect(first.bytes).toEqual(second.bytes);
      const inspected = await inspectSkillBundle(first.bytes);
      expect(inspected.sha256).toBe(sha256Hex(first.bytes));
      expect(inspected.compressedByteSize).toBe(first.bytes.byteLength);
      expect(inspected.decompressedByteSize).toBe(2560);
      expect(inspected.unpackedByteSize).toBe(15);
      expect(inspected.fileCount).toBe(2);
      expect(inspected.entries.map(e => e.path)).toEqual(first.paths);
      expect(new TextDecoder().decode(inspected.entries[0]!.bytes)).toBe("# Safe fixture\n");
      expect(inspected.entries[0]!.bytes.buffer).not.toBe(inspected.entries[1]!.bytes.buffer);
      first.bytes.fill(0);
      expect(new TextDecoder().decode(inspected.entries[0]!.bytes)).toBe("# Safe fixture\n");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("compressed input is snapshotted before asynchronous decompression", async () => {
    const bytes = bundle(entry()); const hash = sha256Hex(bytes);
    const pending = inspectSkillBundle(bytes); bytes.fill(0);
    expect((await pending).sha256).toBe(hash);
  });
  test("accepts maximum 100-byte UTF-8 names and zero-length files", async () => {
    const result = await inspectSkillBundle(bundle(entry("é".repeat(50), new Uint8Array())));
    expect(result.entries[0]!.path).toBe("é".repeat(50));
    expect(result.unpackedByteSize).toBe(0);
  });
  test("allows only complete zero padding after two terminator blocks", async () => {
    const bytes = gzipSync(merge(tar(entry()), new Uint8Array(512)));
    expect((await inspectSkillBundle(bytes)).fileCount).toBe(1);
    await refuses(gzipSync(merge(tar(entry()), new Uint8Array(1))));
    await refuses(gzipSync(merge(tar(entry()), new Uint8Array([1]))));
  });
  test("gzip members cannot smuggle a second archive", async () => {
    expect((await inspectSkillBundle(merge(bundle(entry()), gzipSync(new Uint8Array())))).fileCount).toBe(1);
    await refuses(merge(bundle(entry()), bundle(entry("hidden.txt"))));
  });
  test.each(["../escape", "/absolute", "a/../escape", "a/./b", "a//b", "a/", "a\\b", "C:escape", "bad\nname", ""])("refuses unsafe path %j", async path => {
    await refuses(bundle(entry(path)));
  });
  test.each([["same", "same"], ["A.md", "a.md"], ["é.md", "e\u0301.md"], ["a", "a/b"], ["a/b", "A"]])("refuses aliases and file-directory collisions %j %j", async (a, b) => {
    await refuses(bundle(entry(a), entry(b)));
  });
  test.each([49, 50, 51, 52, 53, 54, 55, 76, 120, 103])("refuses nonregular tar type %d", async type => {
    await refuses(bundle(entry("fixture", undefined, h => { h[156] = type; })));
  });
  test("rejects malformed UTF-8 and data hidden after NUL", async () => {
    await refuses(bundle(entry("x", undefined, h => { h[0] = 0xff; })));
    await refuses(bundle(entry("x", undefined, h => { h[2] = 120; })));
  });
  test("checks checksum, ustar version and unsupported prefix/link names", async () => {
    const corrupted = entry(); corrupted[0] = 88;
    await refuses(bundle(corrupted));
    for (const offset of [157, 257, 263, 345]) await refuses(bundle(entry("fixture", undefined, h => { h[offset] = 88; })));
  });
  test.each(["00000000009\0", "00000001x00\0", "-0000000001\0"])("rejects non-octal size %j", async size => {
    await refuses(bundle(entry("fixture", undefined, h => h.set(encoder.encode(size), 124))));
  });
  test("refuses special permissions and malformed mode", async () => {
    for (const mode of ["0004644\0", "000064x\0"]) await refuses(bundle(entry("fixture", undefined, h => h.set(encoder.encode(mode), 100))));
  });
  test("checks every truncation boundary and nonzero file padding", async () => {
    const raw = tar(entry());
    for (const cut of [0, 100, 511, 512, 520, 1023, 1024, 1536, raw.length - 1]) await refuses(gzipSync(raw.subarray(0, cut)));
    const padded = entry(); padded[1023] = 1; await refuses(bundle(padded));
    const packed = bundle(entry());
    for (const cut of [1, 9, packed.length - 8, packed.length - 1]) await refuses(packed.subarray(0, cut));
    const badCRC = packed.slice(); badCRC[badCRC.length - 8]! ^= 1; await refuses(badCRC);
  });
  test("validates every limit and refuses unknown or unbounded values", async () => {
    for (const key of Object.keys(SKILL_BUNDLE_INSPECTION_LIMITS)) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, undefined]) {
        await refuses(bundle(entry()), "BUNDLE_LIMIT", { limits: { [key]: value } });
      }
    }
    await refuses(bundle(entry()), "BUNDLE_LIMIT", { limits: { unknown: 1 } as never });
    expect(Object.isFrozen(SKILL_BUNDLE_INSPECTION_LIMITS)).toBe(true);
  });
  test("compressed, total, per-file, entry and UTF-8 path budgets enforce exact boundaries", async () => {
    const bytes = bundle(entry());
    expect((await inspectSkillBundle(bytes, { limits: { compressedBytes: bytes.length, decompressedBytes: 2048, fileBytes: 15, entries: 1, pathBytes: 8 } })).fileCount).toBe(1);
    for (const limits of [{ compressedBytes: bytes.length - 1 }, { decompressedBytes: 2047 }, { fileBytes: 14 }, { pathBytes: 7 }]) await refuses(bytes, "BUNDLE_LIMIT", { limits });
    await refuses(bundle(entry("first"), entry("second")), "BUNDLE_LIMIT", { limits: { entries: 1 } });
    await refuses(bundle(entry("é")), "BUNDLE_LIMIT", { limits: { pathBytes: 1 } });
  });
  test("stops malicious expansion during decoding, including tar padding", async () => {
    const bomb = gzipSync(new Uint8Array(64 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100_000);
    await refuses(bomb, "BUNDLE_LIMIT", { limits: { decompressedBytes: 1024 } });
    const oversizedClaim = entry("huge", new Uint8Array(), h => h.set(encoder.encode("77777777777\0"), 124));
    await refuses(bundle(oversizedClaim), "BUNDLE_LIMIT");
  });
  test("already-aborted signal refuses before inspecting or copying caller bytes", async () => {
    const controller = new AbortController(); controller.abort();
    const poisoned = { get byteLength() { throw new Error("must not read input"); } } as unknown as Uint8Array;
    await refuses(poisoned, "BUNDLE_ABORTED", { signal: controller.signal });
  });
  test("signal ownership is stable even if caller mutates options, and listeners are released", async () => {
    const original = new AbortController(); const replacement = new AbortController();
    const options = { signal: original.signal };
    const pending = inspectSkillBundle(bundle(entry()), options);
    options.signal = replacement.signal;
    expect((await pending).fileCount).toBe(1);
    expect(getEventListeners(original.signal, "abort")).toHaveLength(0);
    expect(getEventListeners(replacement.signal, "abort")).toHaveLength(0);
    await refuses(gzipSync(new Uint8Array([1])), "BUNDLE_INVALID", { signal: original.signal });
    expect(getEventListeners(original.signal, "abort")).toHaveLength(0);
  });
  test("actual stream abort and total deadline refuse, then subsequent inspection succeeds", async () => {
    const bomb = gzipSync(new Uint8Array(64 * 1024 * 1024));
    const controller = new AbortController();
    const pending = refuses(bomb, "BUNDLE_ABORTED", { signal: controller.signal });
    const abortTimer = setTimeout(() => controller.abort(), 1);
    try { await pending; } finally { clearTimeout(abortTimer); }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await refuses(bomb, "BUNDLE_TIMEOUT", { limits: { timeoutMs: 1 } });
    expect((await inspectSkillBundle(bundle(entry()))).fileCount).toBe(1);
  });
});
