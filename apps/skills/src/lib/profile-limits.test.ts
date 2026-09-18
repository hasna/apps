import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, MAX_RESOLVED_PROFILE_BYTES, resolvedProfileSnapshot, profileDocumentBytes } from "./profile-limits.js";
import { HttpProfileClient } from "./profile-client.js";
import { saveSkillProfile } from "./profile-admin.js";
import { activateSelectionProfile, readSelectionProfile, readSkillSession, selectionKey, sessionReceiptPath, validateResolvedProfile, writeSelectionJson } from "./selection-cache.js";

useDefaultTestTimeout();
const selections = (count: number) => Array.from({ length: count }, (_, i) => ({ slug: `guide-${i}`, version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }));

test.skipIf(process.platform === "win32")("cache receipt reads refuse a FIFO without waiting for a writer", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-capacity-fifo-")), fifo = join(root, "receipt.json"), script = join(root, "read.ts");
  let timedOut = false;
  try {
    expect(Bun.spawnSync(["mkfifo", fifo], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    writeFileSync(script, `import { readSelectionJson } from ${JSON.stringify(resolve(import.meta.dir, "selection-cache.ts"))};\ntry { readSelectionJson(Bun.argv[2]); } catch (error) { console.error(error.code); process.exit(1); }\n`);
    const child = Bun.spawn([process.execPath, "--no-env-file", script, fifo], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 2_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(exitCode).toBe(1); expect(stdout).toBe(""); expect(stderr).toContain("INVALID_CACHE_FILE");
    } finally { clearTimeout(timeout); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("large writes require adequate advertised capacity and never PUT to old or undersized APIs", async () => {
  const calls: string[] = [];
  let capabilities: unknown = {};
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { calls.push(`${request.method} ${new URL(request.url).pathname}`); return Response.json(capabilities); } });
  const priorUrl = process.env.HASNA_SKILLS_API_URL, priorKey = process.env.HASNA_SKILLS_API_KEY_OVERRIDE;
  process.env.HASNA_SKILLS_API_URL = server.url.origin; process.env.HASNA_SKILLS_API_KEY_OVERRIDE = "fixture-capacity";
  const input = { profileId: "fleet", profileRevision: "one", selections: selections(257) };
  const limits = { maxSelections: MAX_PROFILE_SELECTIONS, maxDocumentBytes: MAX_PROFILE_DOCUMENT_BYTES, maxResolvedProfileBytes: MAX_RESOLVED_PROFILE_BYTES, requestBodyLimitBytes: MAX_PROFILE_DOCUMENT_BYTES };
  try {
    const client = new HttpProfileClient("fixture-capacity", server.url.origin);
    for (capabilities of [{}, { profileLimits: { ...limits, maxSelections: 256 } }, { profileLimits: { ...limits, maxDocumentBytes: 100 } }, { profileLimits: { ...limits, requestBodyLimitBytes: 100 } }, { profileLimits: { ...limits, maxResolvedProfileBytes: 0 } }]) {
      await expect(saveSkillProfile("fleet", input.selections)).rejects.toThrow("does not advertise enough profile capacity");
      await expect(client.recordStation("station", input)).rejects.toThrow("does not advertise enough profile capacity");
    }
    expect(calls).toHaveLength(10); expect(calls.every(call => call === "GET /api/v1/capabilities")).toBe(true);
  } finally {
    server.stop(true);
    if (priorUrl === undefined) delete process.env.HASNA_SKILLS_API_URL; else process.env.HASNA_SKILLS_API_URL = priorUrl;
    if (priorKey === undefined) delete process.env.HASNA_SKILLS_API_KEY_OVERRIDE; else process.env.HASNA_SKILLS_API_KEY_OVERRIDE = priorKey;
  }
});

test("client rejects over-count and over-byte responses even when the API returns success", async () => {
  let value: unknown;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.json(value); } });
  try {
    const client = new HttpProfileClient("fixture-capacity", server.url.origin);
    value = resolvedProfileSnapshot({ id: "fleet", workspaceId: "workspace", revision: "one", selections: selections(MAX_PROFILE_SELECTIONS + 1) }, client.authority);
    await expect(client.resolveProfile("fleet")).rejects.toThrow("invalid profile response");
    value = { ...resolvedProfileSnapshot({ id: "fleet", workspaceId: "workspace", revision: "one", selections: [] }, client.authority), padding: "x".repeat(MAX_RESOLVED_PROFILE_BYTES) };
    await expect(client.resolveProfile("fleet")).rejects.toThrow("invalid profile response");
  } finally { server.stop(true); }
});

test("maximum resolved profile leaves room for every loaded key and an escaped session id", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "skills-capacity-cache-"));
  const profile = resolvedProfileSnapshot({ id: "fleet", workspaceId: "workspace", revision: "one", selections: selections(MAX_PROFILE_SELECTIONS).map(selection => ({ ...selection, triggers: { keywords: Array.from({ length: 6 }, () => "x".repeat(256)) } })) }, "https://example.test/skills/v1");
  // Fill valid trigger terms until the admitted profile is within one term of
  // its limit. The final difference is consumed by extending a nonfull term.
  let room = MAX_RESOLVED_PROFILE_BYTES - profileDocumentBytes(profile);
  for (const selection of profile.selections) {
    const terms = selection.triggers!.keywords!;
    while (terms.length < 32 && room >= 4) {
      const length = Math.min(256, room - 3); terms.push("x".repeat(length)); room -= length + 3;
    }
    if (room < 4) break;
  }
  expect(profileDocumentBytes(profile)).toBeGreaterThan(MAX_RESOLVED_PROFILE_BYTES - 4);
  expect(() => validateResolvedProfile(profile)).not.toThrow();
  const sessionId = "\u0001".repeat(256), loaded = profile.selections.map(selectionKey);
  const receipt = { schemaVersion: 1 as const, verifiedAt: "2026-09-13T00:00:00.000Z", profile, sessionId, loaded, generation: 1,
    parent: { sessionId: "p".repeat(256), generation: Number.MAX_SAFE_INTEGER, receiptSha256: "a".repeat(64) } };
  const path = sessionReceiptPath(sessionId, { cacheDir });
  try {
    writeSelectionJson(path, receipt);
    expect(statSync(path).size).toBeLessThanOrEqual(MAX_PROFILE_DOCUMENT_BYTES);
    expect(readSkillSession(sessionId, { cacheDir })?.loaded).toHaveLength(MAX_PROFILE_SELECTIONS);
    activateSelectionProfile(profile, { cacheDir });
    const before = readSelectionProfile("fleet", { cacheDir });
    const overflow = structuredClone(profile); overflow.selections[0]!.triggers!.paths = ["extra"];
    expect(() => activateSelectionProfile(overflow, { cacheDir })).toThrow("size limit");
    expect(readSelectionProfile("fleet", { cacheDir })).toEqual(before);
    expect(() => validateResolvedProfile({ ...profile, selections: [...profile.selections, profile.selections[0]!] })).toThrow();
    const bytes = readFileSync(path);
    for (const invalid of [[loaded[0], loaded[0]], ["b".repeat(64)]]) {
      writeSelectionJson(path, { ...receipt, loaded: invalid });
      expect(() => readSkillSession(sessionId, { cacheDir })).toThrow("invalid");
    }
    writeFileSync(path, bytes);
    expect(readSkillSession(sessionId, { cacheDir })?.loaded).toHaveLength(MAX_PROFILE_SELECTIONS);
    expect(() => writeSelectionJson(path, { padding: "x".repeat(MAX_PROFILE_DOCUMENT_BYTES) })).toThrow("size limit");
    expect(readFileSync(path)).toEqual(bytes);
    writeFileSync(path, JSON.stringify({ ...receipt, profile: { ...profile, selections: [] }, loaded: [] }, null, 2));
    expect(readSkillSession(sessionId, { cacheDir })?.loaded).toEqual([]);
    writeFileSync(path, "x".repeat(MAX_PROFILE_DOCUMENT_BYTES + 1));
    expect(() => readSkillSession(sessionId, { cacheDir })).toThrow("oversized");
  } finally { rmSync(cacheDir, { recursive: true, force: true }); }
});
