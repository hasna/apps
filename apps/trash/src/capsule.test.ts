import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createCapsule, discardStagedPayload, inspectCapsule, inspectCapsuleStream, restoreCapsule } from "./capsule.js";

const fixtures: string[] = [];
function fixture() { const path = realpathSync(mkdtempSync(join(tmpdir(), "trash-capsule-"))); fixtures.push(path); return path; }
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("capsules preserve binary bytes, Unicode, empty directories, modes and links without following them", () => {
  const root = fixture(); const source = join(root, "source"); mkdirSync(source);
  mkdirSync(join(source, "empty")); writeFileSync(join(source, "résumé.txt"), Buffer.from([0, 255, 10, 13]));
  chmodSync(join(source, "résumé.txt"), 0o640);
  symlinkSync("résumé.txt", join(source, "link")); symlinkSync("../missing", join(source, "dangling"));
  const archive = join(root, "capsule"); const receipt = createCapsule(source, archive);
  expect(existsSync(source)).toBe(true);
  expect(receipt.kind).toBe("dir"); expect(receipt.artifact.sizeBytes).toBe(lstatSync(archive).size);
  expect(receipt.artifact.sha256).toBe(createHash("sha256").update(readFileSync(archive)).digest("hex"));
  expect(inspectCapsule(archive)).toEqual(receipt);
  const target = join(root, "restored"); restoreCapsule(archive, target, receipt);
  expect(readFileSync(join(target, "résumé.txt"))).toEqual(Buffer.from([0, 255, 10, 13]));
  expect(lstatSync(join(target, "résumé.txt")).mode & 0o777).toBe(0o640);
  expect(lstatSync(join(target, "empty")).isDirectory()).toBe(true);
  expect(readlinkSync(join(target, "link"))).toBe("résumé.txt");
  expect(readlinkSync(join(target, "dangling"))).toBe("../missing");
});

for (const kind of ["file", "symlink", "dir"] as const) test(`root ${kind} restores exclusively`, () => {
  const root = fixture(); const source = join(root, "source");
  if (kind === "file") writeFileSync(source, "original");
  else if (kind === "symlink") symlinkSync("/does-not-exist", source);
  else mkdirSync(source);
  const archive = join(root, "capsule"); const receipt = createCapsule(source, archive);
  const target = join(root, "target"); restoreCapsule(archive, target, receipt);
  expect(() => restoreCapsule(archive, target, receipt)).toThrow();
  expect(receipt.kind).toBe(kind);
  expect(() => createCapsule(source, archive)).toThrow();
});

test("tampered content, trailing bytes, truncation and false expected receipts fail before creating a destination", () => {
  const root = fixture(); const source = join(root, "source"); writeFileSync(source, "original");
  const archive = join(root, "capsule"); const receipt = createCapsule(source, archive);
  const bytes = readFileSync(archive); const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  for (const [index, data] of [corrupt, Buffer.concat([bytes, Buffer.from("extra")]), bytes.subarray(0, -1)].entries()) {
    const bad = join(root, `bad${index}`); writeFileSync(bad, data);
    expect(() => restoreCapsule(bad, join(root, `target${index}`), receipt)).toThrow();
    expect(existsSync(join(root, `target${index}`))).toBe(false);
  }
  expect(() => restoreCapsule(archive, join(root, "false"), { ...receipt, sha256: "0".repeat(64) })).toThrow();
  expect(existsSync(join(root, "false"))).toBe(false);
});

test("capture and restore refuse symlink ancestors; capture limits do not remove original bytes", () => {
  const root = fixture(); mkdirSync(join(root, "real")); symlinkSync("real", join(root, "alias"));
  writeFileSync(join(root, "real", "source"), "original");
  expect(() => createCapsule(join(root, "alias", "source"), join(root, "archive"))).toThrow();
  expect(() => createCapsule(join(root, "real", "source"), join(root, "large"), { maxBytes: 3 })).toThrow();
  expect(readFileSync(join(root, "real", "source"), "utf8")).toBe("original");
  const receipt = createCapsule(join(root, "real", "source"), join(root, "valid"));
  expect(() => restoreCapsule(join(root, "valid"), join(root, "alias", "target"), receipt)).toThrow();
  expect(existsSync(join(root, "real", "target"))).toBe(false);
});

test("malicious manifests reject traversal, duplicate paths, symlink parents, invalid lengths and unsupported types", () => {
  const root = fixture();
  const dir = { path: ".", kind: "dir", mode: 0o700 };
  const link = { path: "alias", kind: "symlink", mode: 0o777, target: "/tmp" };
  const file = { path: "a", kind: "file", mode: 0o600, size: 0, sha256: createHash("sha256").digest("hex") };
  const manifests = [
    [dir, { ...file, path: "../outside" }], [dir, { ...file, path: "/outside" }],
    [dir, file, file], [dir, link, { ...file, path: "alias/escape" }],
    [dir, { ...file, path: "a//b" }], [dir, { ...file, size: -1 }],
    [dir, { ...file, kind: "fifo" }], [dir, { ...file, mode: 0o4755 }],
    [dir, { ...file, path: "a/child" }], [dir, { ...file, path: "a\0b" }],
  ];
  for (const [i, entries] of manifests.entries()) {
    const manifest = Buffer.from(JSON.stringify({ version: 1, entries }));
    const header = Buffer.alloc(12); header.write("HTRASH1\n"); header.writeUInt32BE(manifest.length, 8);
    const path = join(root, `bad${i}`); writeFileSync(path, Buffer.concat([header, manifest]));
    expect(() => inspectCapsule(path)).toThrow();
  }
});

test("directory entry and depth caps bound trees of empty files", () => {
  const root = fixture(); const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "a"), ""); writeFileSync(join(source, "b"), "");
  expect(() => createCapsule(source, join(root, "count"), { maxEntries: 2 })).toThrow();
  mkdirSync(join(source, "nested")); mkdirSync(join(source, "nested", "deeper"));
  expect(() => createCapsule(source, join(root, "depth"), { maxDepth: 1 })).toThrow();
});

test("stream verification handles fragmented headers and rejects truncated or trailing content", async () => {
  const root = fixture(); const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "bytes"), Buffer.from([1, 0, 255])); symlinkSync("bytes", join(source, "link"));
  const archive = join(root, "capsule"); const receipt = createCapsule(source, archive); const bytes = readFileSync(archive);
  function stream(data: Uint8Array) { let i = 0; return new ReadableStream<Uint8Array>({ pull(controller) { if (i < data.length) controller.enqueue(data.slice(i, ++i)); else controller.close(); } }); }
  expect(await inspectCapsuleStream(stream(bytes), bytes.length)).toEqual(receipt);
  await expect(inspectCapsuleStream(stream(bytes.subarray(0, -1)), bytes.length)).rejects.toThrow();
  await expect(inspectCapsuleStream(stream(Buffer.concat([bytes, Buffer.from("x")])), bytes.length)).rejects.toThrow();
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  await expect(inspectCapsuleStream(stream(corrupt), corrupt.length)).rejects.toThrow();
});

test("staging cleanup refuses changed captured bytes and never removes newly added files", () => {
  const root = fixture(); const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "captured"), "original");
  const archive = join(root, "capsule"); const receipt = createCapsule(source, archive);
  writeFileSync(join(source, "captured"), "changed");
  expect(() => discardStagedPayload(archive, source, receipt)).toThrow();
  expect(readFileSync(join(source, "captured"), "utf8")).toBe("changed");
  writeFileSync(join(source, "captured"), "original"); writeFileSync(join(source, "new"), "uncaptured");
  expect(() => discardStagedPayload(archive, source, receipt)).toThrow();
  expect(readFileSync(join(source, "new"), "utf8")).toBe("uncaptured");
  rmSync(join(source, "new")); discardStagedPayload(archive, source, receipt);
  expect(existsSync(source)).toBe(false);
  discardStagedPayload(archive, source, receipt); // An interrupted cleanup can repeat.
});
