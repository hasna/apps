import { describe, expect, test } from "bun:test";
import { BundleIntegrityError, computeBundleDigest, MODE_DATA, MODE_SCRIPT } from "./manifest.js";
import { concat, manifestFilesFor, ownBytes, type BundleEntry, type OwnedBytes } from "./pack.js";
import { unpackBundle, verifyArchiveSha256, verifyBundleAgainstManifest } from "./unpack.js";
import { buildManifest } from "./local.js";

const BLOCK = 512;

/**
 * A tar writer that will emit anything, including what `writeTar` refuses to.
 *
 * The extraction gate has to be tested against archives our own packer cannot
 * produce - those are exactly the archives a hostile server would send.
 */
function hostileTar(entries: Array<{ path: string; body: string; mode?: number; typeflag?: string }>, opts: { terminate?: boolean } = {}): OwnedBytes {
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(new ArrayBuffer(BLOCK));
    const put = (offset: number, value: string) => header.set(encoder.encode(value), offset);
    const body = encoder.encode(entry.body);
    put(0, entry.path);
    put(100, `${(entry.mode ?? MODE_DATA).toString(8).padStart(7, "0")}\0`);
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${body.byteLength.toString(8).padStart(11, "0")}\0`);
    put(136, `${(0).toString(8).padStart(11, "0")}\0`);
    put(148, "        ");
    put(156, entry.typeflag ?? "0");
    put(257, "ustar\0");
    put(263, "00");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    put(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, body);
    const remainder = body.byteLength % BLOCK;
    if (remainder !== 0) blocks.push(new Uint8Array(new ArrayBuffer(BLOCK - remainder)));
  }
  if (opts.terminate !== false) blocks.push(new Uint8Array(new ArrayBuffer(BLOCK * 2)));
  return concat(blocks);
}

function archive(entries: Parameters<typeof hostileTar>[0], opts?: { terminate?: boolean }): OwnedBytes {
  return ownBytes(Bun.zstdCompressSync(hostileTar(entries, opts), { level: 1 }));
}

const goodLoopJson = { path: "loop.json", body: `{"schema":"hasna.loop.bundle.v1","id":"lp_1","name":"demo"}` };

describe("unpackBundle refuses unsafe archives", () => {
  test("a traversal path", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "../escape.sh", body: "x", mode: MODE_DATA }]))).toThrow(/'\.\.'/);
  });

  test("an absolute path", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "/etc/cron.d/evil", body: "x" }]))).toThrow(/absolute/);
  });

  test("a backslash path", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "a\\b", body: "x" }]))).toThrow(/backslash/);
  });

  test("a symlink entry", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "scripts/link", body: "", mode: MODE_SCRIPT, typeflag: "2" }]))).toThrow(/only regular files/);
  });

  test("a directory entry", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "scripts", body: "", mode: MODE_SCRIPT, typeflag: "5" }]))).toThrow(/only regular files/);
  });

  test("a GNU long-link header whose BODY carries the real path", () => {
    // The header path is a harmless-looking placeholder that passes the path
    // check; only the typeflag reveals that the body is the real destination.
    expect(() => unpackBundle(archive([goodLoopJson, { path: "notes.txt", body: "../../etc/passwd", typeflag: "L" }]))).toThrow(/only regular files/);
  });

  test("a mode that does not match the path's contract", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "scripts/run.sh", body: "x", mode: MODE_DATA }]))).toThrow(/mode must be/);
    expect(() => unpackBundle(archive([goodLoopJson, { path: "README.md", body: "x", mode: MODE_SCRIPT }]))).toThrow(/mode must be/);
  });

  test("a duplicate path", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "a.txt", body: "1" }, { path: "a.txt", body: "2" }]))).toThrow(/duplicate/);
  });

  test("an embedded manifest.json or pull marker", () => {
    expect(() => unpackBundle(archive([goodLoopJson, { path: "manifest.json", body: "{}" }]))).toThrow(/never part of an archive/);
    expect(() => unpackBundle(archive([goodLoopJson, { path: ".loops-bundle.json", body: "{}" }]))).toThrow(/never part of an archive/);
  });

  test("a truncated archive, which is NOT an archive that ended", () => {
    expect(() => unpackBundle(archive([goodLoopJson], { terminate: false }))).toThrow(/truncated/);
  });

  test("bytes that are not zstd at all", () => {
    expect(() => unpackBundle(new TextEncoder().encode("not an archive"))).toThrow(/not readable zstd/);
  });

  test("an empty archive", () => {
    expect(() => unpackBundle(archive([]))).toThrow(/no files/);
  });
});

describe("verification", () => {
  function entriesFor(files: Array<{ path: string; body: string; mode: number }>): BundleEntry[] {
    return files
      .map((file) => ({ path: file.path, mode: file.mode, bytes: ownBytes(new TextEncoder().encode(file.body)) }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  const entries = entriesFor([
    { path: "loop.json", body: goodLoopJson.body, mode: MODE_DATA },
    { path: "scripts/run.sh", body: "#!/bin/sh\n", mode: MODE_SCRIPT },
  ]);
  const manifest = buildManifest({ name: "demo", loopId: "lp_1", version: 1, files: manifestFilesFor(entries) });

  test("accepts entries that match the manifest exactly", () => {
    expect(() => verifyBundleAgainstManifest(entries, manifest)).not.toThrow();
  });

  test("refuses an extra file the manifest does not list", () => {
    const extra = entriesFor([
      { path: "loop.json", body: goodLoopJson.body, mode: MODE_DATA },
      { path: "scripts/run.sh", body: "#!/bin/sh\n", mode: MODE_SCRIPT },
      { path: "scripts/extra.sh", body: "#!/bin/sh\n", mode: MODE_SCRIPT },
    ]);
    expect(() => verifyBundleAgainstManifest(extra, manifest)).toThrow(/unexpected: scripts\/extra.sh/);
  });

  test("refuses a changed file, naming the path only", () => {
    const changed = entriesFor([
      { path: "loop.json", body: goodLoopJson.body, mode: MODE_DATA },
      { path: "scripts/run.sh", body: "#!/bin/sh\nrm -rf /\n", mode: MODE_SCRIPT },
    ]);
    let message = "";
    try {
      verifyBundleAgainstManifest(changed, manifest);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("changed: scripts/run.sh");
    expect(message).not.toContain("rm -rf");
  });

  test("refuses a manifest whose digest was recomputed over a different set", () => {
    const forged = { ...manifest, bundleDigest: computeBundleDigest([manifest.files[0]!]) };
    expect(() => verifyBundleAgainstManifest(entries, forged)).toThrow(BundleIntegrityError);
  });

  test("verifyArchiveSha256 refuses bytes that are not the ones the manifest was written for", () => {
    expect(() => verifyArchiveSha256(new TextEncoder().encode("x"), "0".repeat(64))).toThrow(/does not match the declared/);
  });
});
