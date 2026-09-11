import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Hash, type BinaryLike, type Encoding } from "node:crypto";
import { getEventListeners } from "node:events";
import { useDefaultTestTimeout } from "../test-preload.js";
import { collectSkillBundleEntries, inspectSkillBundle, packSkillBundle, type SkillBundleEntry } from "./skill-bundle.js";
import { canonicalizeManifest, computeContentHash, computeContentHashFromEntries, verifyContentHashFromEntries, ContentHashInputError, CONTENT_HASH_LIMITS, type ContentHashInputErrorCode, type ContentHashOptions } from "./skill-hash.js";
import { validatePortableManifestContract } from "./skill-contract.js";
import { revisionIdOf, type RevisionContent } from "./revision.js";
import { contentEntry, contentHashFixture } from "./skill-hash-entries.fixture.js";

useDefaultTestTimeout();
// Captured from the unfactored c04969a6 directory/revision oracle, not the new implementation.
const GOLDEN_HASH = "66d1cb9ad30b2358004c25ef4adbc487427d598741828d18bc5dcd22ed62953c";
const EMPTY_HASH = "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d";

async function directory(entries: SkillBundleEntry[], action: (path: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "skill-entry-hash-"));
  try {
    for (const entry of entries) { const path = join(root, entry.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, entry.bytes, { mode: entry.mode }); }
    await action(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function refusal(input: unknown, code: ContentHashInputErrorCode, options?: ContentHashOptions) {
  let error: unknown;
  try { await computeContentHashFromEntries(input as SkillBundleEntry[], options); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ContentHashInputError);
  expect((error as ContentHashInputError).code).toBe(code);
  expect((error as Error).message.length).toBeLessThan(100);
}

test("original golden directory, ordinary entries and actual inspected archive have identical hashes", async () => {
  const entries = contentHashFixture();
  await directory(entries, async root => {
    expect(computeContentHash(root)).toBe(GOLDEN_HASH);
    expect(await computeContentHashFromEntries(entries)).toBe(GOLDEN_HASH);
    expect(await computeContentHashFromEntries([...entries].reverse())).toBe(GOLDEN_HASH);
    expect(await computeContentHashFromEntries(collectSkillBundleEntries(root))).toBe(GOLDEN_HASH);
    const packed = packSkillBundle(root), inspected = await inspectSkillBundle(packed.bytes);
    expect(inspected.sha256).toBe(packed.sha256);
    expect(await computeContentHashFromEntries(inspected.entries)).toBe(GOLDEN_HASH);
    for (const entry of entries) expect(new Uint8Array(readFileSync(join(root, entry.path)))).toEqual(entry.bytes);
  });
  await directory([], async root => { expect(computeContentHash(root)).toBe(EMPTY_HASH); expect(await computeContentHashFromEntries([])).toBe(EMPTY_HASH); });
});

test("normalization preserves binary and legacy nonfatal UTF8 while blanking only manifest self hashes", async () => {
  const entries = contentHashFixture();
  for (const entry of entries) if (!entry.bytes.includes(0)) entry.bytes = new TextEncoder().encode(new TextDecoder().decode(entry.bytes).replace(/\r\n?/g, "\n"));
  const manifestEntry = entries.find(entry => entry.path === "skill.json")!;
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  manifest.content_hash = "c".repeat(64); manifest.provenance.content_hash = "d".repeat(64);
  manifestEntry.bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse()), null, 2));
  expect(await computeContentHashFromEntries(entries)).toBe(GOLDEN_HASH);
  manifest.provenance.source_commit = "different";
  manifestEntry.bytes = new TextEncoder().encode(JSON.stringify(manifest));
  expect(await computeContentHashFromEntries(entries)).not.toBe(GOLDEN_HASH);
  entries.find(entry => entry.path === "assets/image.bin")!.bytes[0] = 1;
  await directory(entries, async root => expect(await computeContentHashFromEntries(entries)).toBe(computeContentHash(root)));
  for (const raw of ['{"__proto__":{"x":1},"constructor":2}', "not-json\r\n", "[1,2]", "null"]) {
    const input = [contentEntry("skill.json", raw)];
    await directory(input, async root => expect(await computeContentHashFromEntries(input)).toBe(computeContentHash(root)));
  }
});

test("excluded paths do not affect identity but covered regular build filenames still do", async () => {
  const entries = contentHashFixture();
  for (const path of ["README.md", "build/output.txt", "src/node_modules/dependency.txt", "assets/build/output.txt", "assets/.hidden"]) entries.find(entry => entry.path === path)!.bytes = new TextEncoder().encode("changed excluded content");
  expect(await computeContentHashFromEntries(entries)).toBe(GOLDEN_HASH);
  entries.find(entry => entry.path === "scripts/build")!.bytes = new TextEncoder().encode("changed included regular file");
  expect(await computeContentHashFromEntries(entries)).not.toBe(GOLDEN_HASH);
});

test("canonical manifest sorting preserves own prototype-named JSON keys at every depth", () => {
  const first = '{"nested":[{"b":2,"__proto__":{"owned":3},"a":1}],"constructor":{"prototype":{"owned":2}},"__proto__":{"owned":1},"provenance":{"content_hash":"self","__proto__":{"owned":4}},"content_hash":"self"}';
  const reordered = '{"__proto__":{"owned":1},"content_hash":"other-self","constructor":{"prototype":{"owned":2}},"provenance":{"__proto__":{"owned":4},"content_hash":"other-self"},"nested":[{"a":1,"__proto__":{"owned":3},"b":2}]}';
  const canonical = canonicalizeManifest(first), parsed = JSON.parse(canonical);
  expect(canonicalizeManifest(reordered)).toBe(canonical);
  expect(Object.keys(parsed)).toEqual(["__proto__", "constructor", "nested", "provenance"]);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  expect(parsed.__proto__).toEqual({ owned: 1 });
  expect(parsed.constructor).toEqual({ prototype: { owned: 2 } });
  expect(Object.keys(parsed.nested[0])).toEqual(["__proto__", "a", "b"]);
  expect(parsed.nested[0].__proto__).toEqual({ owned: 3 });
  expect(Object.hasOwn(parsed.provenance, "__proto__")).toBe(true);
  expect(parsed.provenance.__proto__).toEqual({ owned: 4 });
  expect(parsed.provenance.content_hash).toBeUndefined();
  expect(({} as Record<string, unknown>).owned).toBeUndefined();
});

test("own prototype-named manifest data cannot collide or change under a valid declaration", async () => {
  const raw = '{"standard":"hasna.skill.v1","name":"owned-key","description":"Owned identity fixture","version":"1.0.0","inputs":[],"commands":[],"runtime":{"runtime":"bun","entrypoint":"src/index.ts","sandbox":"readonly-fs"},"provenance":{},"extensions":{"__proto__":{"owned":1},"constructor":{"prototype":{"owned":2}}}}';
  const parsed = JSON.parse(raw), entries = [contentEntry("skill.json", raw)];
  const originalHash = await computeContentHashFromEntries(entries);
  const removed = JSON.parse(raw); delete removed.extensions.__proto__;
  expect(await computeContentHashFromEntries([contentEntry("skill.json", JSON.stringify(removed))])).not.toBe(originalHash);
  const changedConstructor = JSON.parse(raw); changedConstructor.extensions.constructor.prototype.owned = 3;
  expect(await computeContentHashFromEntries([contentEntry("skill.json", JSON.stringify(changedConstructor))])).not.toBe(originalHash);
  await directory(entries, async root => expect(computeContentHash(root)).toBe(originalHash));
  parsed.provenance.content_hash = originalHash;
  expect(validatePortableManifestContract(parsed, { strict: true })).toEqual([]);
  expect(await verifyContentHashFromEntries([contentEntry("skill.json", JSON.stringify(parsed))]))
    .toEqual({ declared: true, valid: true, declaredHash: originalHash, computedHash: originalHash });
  parsed.extensions.__proto__.owned = 2;
  const verification = await verifyContentHashFromEntries([contentEntry("skill.json", JSON.stringify(parsed))]);
  expect(verification.declared).toBe(true); expect(verification.valid).toBe(false);
  expect(verification.declaredHash).toBe(originalHash); expect(verification.computedHash).not.toBe(originalHash);
  expect(new TextDecoder().decode(entries[0]!.bytes)).toBe(raw);
});

test("verification binds the same captured manifest and validates entries even without a usable declaration", async () => {
  const entries = contentHashFixture(), manifest = entries.find(entry => entry.path === "skill.json")!;
  const value = JSON.parse(new TextDecoder().decode(manifest.bytes));
  value.provenance.content_hash = GOLDEN_HASH; manifest.bytes = new TextEncoder().encode(JSON.stringify(value));
  expect(await verifyContentHashFromEntries(entries)).toEqual({ declared: true, valid: true, declaredHash: GOLDEN_HASH, computedHash: GOLDEN_HASH });
  value.provenance.content_hash = "a".repeat(64); manifest.bytes = new TextEncoder().encode(JSON.stringify(value));
  expect((await verifyContentHashFromEntries(entries)).valid).toBe(false);
  value.provenance.content_hash = "not-a-hash"; manifest.bytes = new TextEncoder().encode(JSON.stringify(value));
  expect(await verifyContentHashFromEntries(entries)).toEqual({ declared: true, valid: false, declaredHash: "not-a-hash" });
  delete value.provenance.content_hash; manifest.bytes = new TextEncoder().encode(JSON.stringify(value));
  expect(await verifyContentHashFromEntries(entries)).toEqual({ declared: false, valid: false });
  await expect(verifyContentHashFromEntries([...entries, contentEntry("../outside", "")])).rejects.toBeInstanceOf(ContentHashInputError);
  value.provenance.content_hash = [GOLDEN_HASH]; manifest.bytes = new TextEncoder().encode(JSON.stringify(value));
  await expect(verifyContentHashFromEntries(entries)).rejects.toBeInstanceOf(ContentHashInputError);
});

test("malformed ordinary entries, collisions and accessors refuse without calling supplied getters", async () => {
  for (const path of ["", "/absolute", "../parent", "src/../x", "src//x", "src/./x", "src\\x", "C:x", "src/\0x", "src/\ud800"]) await refusal([contentEntry(path, "")], "CONTENT_HASH_INVALID");
  for (const paths of [["README.md", "readme.md"], ["assets/café", "assets/cafe\u0301"], ["outside", "outside/child"], ["outside/child", "outside"]]) await refusal(paths.map(path => contentEntry(path, "")), "CONTENT_HASH_INVALID");
  for (const input of [null, {}, [null], new Array(1), [{ path: "SKILL.md", mode: 0o644, bytes: "text" }], [{ ...contentEntry("SKILL.md", ""), mode: 0o1000 }], [{ ...contentEntry("SKILL.md", ""), type: "symlink" }], [{ ...contentEntry("SKILL.md", ""), bytes: new Uint8Array(new SharedArrayBuffer(1)) }]]) await refusal(input, "CONTENT_HASH_INVALID");
  let getters = 0;
  const entry = { bytes: new Uint8Array(), mode: 0o644, get path() { getters++; return "SKILL.md"; } };
  await refusal([entry], "CONTENT_HASH_INVALID");
  const options = { get signal() { getters++; return undefined; } };
  await refusal([], "CONTENT_HASH_INVALID", options);
  expect(getters).toBe(0);
});

test("all input and normalized budgets are finite, tighten-only and include excluded input", async () => {
  expect(Object.isFrozen(CONTENT_HASH_LIMITS)).toBe(true);
  await refusal([contentEntry("SKILL.md", "ab"), contentEntry("README.md", "cd")], "CONTENT_HASH_LIMIT", { limits: { entries: 1 } });
  await refusal([contentEntry("README.md", "1234")], "CONTENT_HASH_LIMIT", { limits: { rawBytes: 3 } });
  await refusal([contentEntry("SKILL.md", "1234")], "CONTENT_HASH_LIMIT", { limits: { fileBytes: 3 } });
  await refusal([contentEntry("SKILL.md", [255, 255])], "CONTENT_HASH_LIMIT", { limits: { normalizedFileBytes: 5 } });
  await refusal([contentEntry("SKILL.md", [255]), contentEntry("AGENTS.md", [255])], "CONTENT_HASH_LIMIT", { limits: { normalizedBytes: 5 } });
  await refusal([contentEntry("SKILL.md", "")], "CONTENT_HASH_LIMIT", { limits: { pathBytes: 7 } });
  await refusal([contentEntry("skill.json", "{} ")], "CONTENT_HASH_LIMIT", { limits: { manifestBytes: 2 } });
  await refusal([contentEntry("skill.json", '{"a":{"b":{}}}')], "CONTENT_HASH_LIMIT", { limits: { manifestDepth: 2 } });
  for (const value of [0, -1, Infinity, NaN, 1.5, CONTENT_HASH_LIMITS.entries + 1]) await refusal([], "CONTENT_HASH_LIMIT", { limits: { entries: value } });
  await refusal([], "CONTENT_HASH_INVALID", { limits: { unknown: 1 } } as ContentHashOptions);
});

test("captured bytes survive caller mutation and abort/deadline paths release listeners", async () => {
  const entries = contentHashFixture();
  const pending = computeContentHashFromEntries(entries);
  for (const entry of entries) { entry.bytes.fill(0); entry.path = "changed"; }
  expect(await pending).toBe(GOLDEN_HASH);
  const before = new AbortController(); before.abort();
  await refusal([], "CONTENT_HASH_ABORTED", { signal: before.signal });
  const during = new AbortController(); const aborted = computeContentHashFromEntries(contentHashFixture(), { signal: during.signal }); during.abort();
  await expect(aborted).rejects.toMatchObject({ code: "CONTENT_HASH_ABORTED" });
  const large = Array.from({ length: 16 }, (_, i) => contentEntry(`src/${i}.bin`, []));
  for (const entry of large) entry.bytes = new Uint8Array(new ArrayBuffer(4 * 1024 * 1024));
  await refusal(large, "CONTENT_HASH_TIMEOUT", { limits: { timeoutMs: 1 } });
  for (const input of [[], [contentEntry("../bad", "")]]) {
    const controller = new AbortController(); let added = 0, removed = 0;
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args: Parameters<typeof add>) => { added++; add(...args); };
    controller.signal.removeEventListener = (...args: Parameters<typeof remove>) => { removed++; remove(...args); };
    await computeContentHashFromEntries(input, { signal: controller.signal }).catch(() => {});
    expect(added).toBe(1); expect(removed).toBe(1);
  }
});

test("revision oracle keeps fixed field order, null defaults and all content fields load-bearing", () => {
  const content: RevisionContent = { slug: "hash-fixture", displayName: "Hash Fixture", description: "Fixture.", category: "Development", tags: ["one", "two"], source: "private", kind: "instruction" };
  expect(revisionIdOf(content)).toBe("5187855fb5088247a5551ee18ee8e27cfe47466b019b4443b992f0e233c79248");
  expect(revisionIdOf({ ...content, version: "1.0.0", skillMd: "Body.\r\n", bundleSha256: "a".repeat(64), bundleByteSize: 123 })).toBe("104743632a1fa6c6455e97f34cef458877750d0250305222a298a78d1c655d61");
  expect(revisionIdOf(Object.fromEntries(Object.entries(content).reverse()) as unknown as RevisionContent)).toBe(revisionIdOf(content));
  expect(revisionIdOf({ ...content, version: undefined, skillMd: undefined, bundleSha256: undefined, bundleByteSize: undefined })).toBe(revisionIdOf(content));
  for (const field of ["slug", "displayName", "description", "category", "source", "version", "skillMd", "bundleSha256"] as const) expect(revisionIdOf({ ...content, [field]: "changed" })).not.toBe(revisionIdOf(content));
  for (const delta of [{ tags: ["two", "one"] }, { kind: "executable" as const }, { bundleByteSize: 1 }]) expect(revisionIdOf({ ...content, ...delta })).not.toBe(revisionIdOf(content));
});

test("normalization yields to a real abort timer and captures the original signal and limits", async () => {
  const entries = Array.from({ length: 16 }, (_, index) => ({ path: `src/${index}.txt`, mode: 0o644, bytes: new Uint8Array(new ArrayBuffer(1024 * 1024)).fill(65) }));
  const controller = new AbortController(), replacement = new AbortController();
  const options: ContentHashOptions = { signal: controller.signal, limits: { rawBytes: 16 * 1024 * 1024 } };
  const pending = computeContentHashFromEntries(entries, options);
  options.signal = replacement.signal; options.limits!.rawBytes = 1;
  let fired = false;
  const timer = setTimeout(() => { fired = true; controller.abort(); }, 1);
  try { await expect(pending).rejects.toMatchObject({ code: "CONTENT_HASH_ABORTED" }); }
  finally { clearTimeout(timer); }
  expect(fired).toBe(true); expect(replacement.signal.aborted).toBe(false);
  expect(await computeContentHashFromEntries([])).toBe(EMPTY_HASH);
});

test("maximum input remains cancellable during actual SHA256 work, after normalization finishes", async () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({ path: `assets/${index}.bin`, mode: 0o644, bytes: new Uint8Array(new ArrayBuffer(CONTENT_HASH_LIMITS.fileBytes)) }));
  const controller = new AbortController(), update = Hash.prototype.update;
  let bodyBytes = 0, scheduled = false, timer: ReturnType<typeof setTimeout> | undefined;
  // Observe genuine crypto work; preserve its exact implementation and output.
  Hash.prototype.update = function (this: Hash, data: BinaryLike, inputEncoding?: Encoding): Hash {
    if (data instanceof Uint8Array && data.byteLength >= 64 * 1024) {
      bodyBytes += data.byteLength;
      if (!scheduled) { scheduled = true; timer = setTimeout(() => controller.abort(), 1); }
    }
    return Reflect.apply(update, this, inputEncoding === undefined ? [data] : [data, inputEncoding]);
  };
  try { await expect(computeContentHashFromEntries(entries, { signal: controller.signal })).rejects.toMatchObject({ code: "CONTENT_HASH_ABORTED" }); }
  finally { Hash.prototype.update = update; if (timer) clearTimeout(timer); }
  expect(scheduled).toBe(true); expect(bodyBytes).toBeGreaterThan(0); expect(bodyBytes).toBeLessThan(CONTENT_HASH_LIMITS.rawBytes);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  const maxEntries = Array.from({ length: CONTENT_HASH_LIMITS.entries }, (_, index) => contentEntry(`outside/${index}`, ""));
  expect(await computeContentHashFromEntries(maxEntries)).toBe(EMPTY_HASH);
  await refusal([...maxEntries, contentEntry("outside/extra", "")], "CONTENT_HASH_LIMIT");
});
