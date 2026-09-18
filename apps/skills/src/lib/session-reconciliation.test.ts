import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { readSkillSession, readSkillSessionSnapshot, selectionKey, sessionReceiptPath, skillSessionSnapshotBinding, writeSelectionJson, writeSkillSession, type SkillSessionReceipt } from "./selection-cache.js";
import { buildSkillContext } from "./skill-context.js";
import { packSkillBundle } from "./skill-bundle.js";
import { reconcileSkillSession, inspectSkillSession } from "./session-reconciliation.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(loaded = true) {
  const cacheDir = mkdtempSync(join(tmpdir(), "skills-session-reconcile-")); roots.push(cacheDir);
  const profile: ResolvedSkillProfile = {
    authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileId: "legacy", profileRevision: "old-revision",
    selections: [{ authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileRevision: "old-revision", slug: "example", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }],
  };
  const old: SkillSessionReceipt = { schemaVersion: 1, verifiedAt: "2026-01-01T00:00:00Z", profile, sessionId: "root", loaded: loaded ? [selectionKey(profile.selections[0]!)] : [] };
  writeSelectionJson(sessionReceiptPath("root", { cacheDir }), old);
  const target = { ...profile, profileId: "shared", profileRevision: "new-revision", selections: profile.selections.map(selection => ({ ...selection, profileRevision: "new-revision" })) };
  const client: ProfileClient = { authority: profile.authority, resolveProfile: async () => target, getBundle: async () => { throw new Error("This metadata operation must not fetch bundles"); }, recordStation: async () => { throw new Error("This local operation must not report station state"); } };
  const before = readFileSync(sessionReceiptPath("root", { cacheDir }));
  const input = { sessionId: "root", fromProfile: "legacy", fromRevision: "old-revision", receiptSha256: createHash("sha256").update(before).digest("hex"), selectionProfile: "shared", profileRevision: "new-revision" };
  return { cacheDir, old, target, client, before, input };
}

function approval(planned: Awaited<ReturnType<typeof reconcileSkillSession>>) {
  return { planDigest: planned.planDigest, planIssuedAt: planned.plan.issuedAt, planExpiresAt: planned.plan.expiresAt };
}

test("an intentional root migration archives exact bytes and permits new children without relaxing old pin checks", async () => {
  const f = fixture(false);
  await expect(buildSkillContext({ profileId: "shared", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: f.client })).rejects.toMatchObject({ code: "PROFILE_LOCK_MISMATCH" });
  const planned = await reconcileSkillSession(f.input, { cacheDir: f.cacheDir, client: f.client });
  expect(planned.applied).toBe(false);
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const result = await reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { cacheDir: f.cacheDir, client: f.client });
  expect(result.applied).toBe(true);
  expect(readFileSync(result.archivePath!)).toEqual(f.before);
  expect(lstatSync(result.archivePath!).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(result.receiptPath!, "utf8")).status).toBe("applied");
  expect(readSkillSession("root", f)?.loaded).toEqual(f.old.loaded);
  expect(inspectSkillSession("root", f).profileId).toBe("shared");
  expect((await buildSkillContext({ profileId: "shared", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: f.client })).receipt.profileRevision).toBe("new-revision");
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root" }, { cacheDir: f.cacheDir, client: f.client })).rejects.toMatchObject({ code: "PROFILE_LOCK_MISMATCH" });
});


test("a child resolution cannot commit an old parent pin after parent reconciliation", async () => {
  const f = fixture(false);
  const source = mkdtempSync(join(tmpdir(), "skills-session-race-bundle-")); roots.push(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: example\ndescription: Deterministic race fixture\nkind: instruction\n---\n\nReview carefully.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "example", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const oldProfile = { ...f.old.profile, selections: f.old.profile.selections.map(selection => ({ ...selection, bundleDigest: `sha256:${bundle.sha256}` })) };
  const old = { ...f.old, profile: oldProfile, loaded: [selectionKey(oldProfile.selections[0]!)] };
  writeSelectionJson(sessionReceiptPath("root", f), old);
  const before = readFileSync(sessionReceiptPath("root", f));
  const input = { ...f.input, receiptSha256: createHash("sha256").update(before).digest("hex") };
  const target = { ...f.target, selections: f.target.selections.map(selection => ({ ...selection, bundleDigest: `sha256:${bundle.sha256}` })) };
  const reconcileClient = { ...f.client, resolveProfile: async () => target };
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const childClient: ProfileClient = {
    ...f.client,
    resolveProfile: async () => oldProfile,
    getBundle: async () => { entered(); await blocked; return new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": "1.0.0" } }); },
  };
  const child = buildSkillContext({ profileId: "legacy", sessionId: "root", agentId: "child" }, { cacheDir: f.cacheDir, client: childClient });
  await started;
  const plan = await reconcileSkillSession(input, { cacheDir: f.cacheDir, client: reconcileClient });
  await reconcileSkillSession({ ...input, apply: true, ...approval(plan) }, { cacheDir: f.cacheDir, client: reconcileClient });
  release();
  await expect(child).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(readSkillSession("root:child", f)).toBeNull();
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
});

test("child commit refuses an ABA parent profile when the receipt generation advanced", async () => {
  const f = fixture(false);
  const originalSnapshot = readSkillSessionSnapshot("root", f);
  const forward = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(forward) }, f);
  const current = readSkillSessionSnapshot("root", f);
  const backInput = {
    sessionId: "root", fromProfile: "shared", fromRevision: "new-revision", receiptSha256: current.sha256,
    selectionProfile: "legacy", profileRevision: "old-revision",
  };
  const backClient = { ...f.client, resolveProfile: async () => f.old.profile };
  const back = await reconcileSkillSession(backInput, { ...f, client: backClient });
  await reconcileSkillSession({ ...backInput, apply: true, ...approval(back) }, { ...f, client: backClient });
  const restored = readSkillSessionSnapshot("root", f);
  expect(restored.receipt.profile).toEqual(f.old.profile);
  expect(restored.generation).toBe(2);
  const child: SkillSessionReceipt = { ...f.old, sessionId: "root:aba-child", loaded: [] };
  expect(() => writeSkillSession(child, { current: null, parent: skillSessionSnapshotBinding(originalSnapshot) }, f))
    .toThrow(expect.objectContaining({ code: "SESSION_PARENT_CHANGED" }));
  expect(readSkillSession("root:aba-child", f)).toBeNull();
});

test("child creation requires an exact existing parent and never falls through to an API pin", async () => {
  const f = fixture(false);
  rmSync(sessionReceiptPath("root", f));
  let resolved = false;
  const client = { ...f.client, resolveProfile: async () => { resolved = true; return f.old.profile; } };
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root", agentId: "missing-parent" }, { cacheDir: f.cacheDir, client }))
    .rejects.toMatchObject({ code: "SESSION_PARENT_NOT_FOUND" });
  expect(resolved).toBe(false);
  expect(readSkillSession("root:missing-parent", f)).toBeNull();
});

test("deterministic parent-child lock ordering releases earlier locks when a later lock is busy", () => {
  const f = fixture(false), parent = readSkillSessionSnapshot("root", f);
  const childId = "root:lock-order", child: SkillSessionReceipt = { ...f.old, sessionId: childId, loaded: [] };
  const locks = [sessionReceiptPath("root", f), sessionReceiptPath(childId, f)].map(path => `${path}.write-lock`).sort();
  writeFileSync(locks[1]!, "busy-later-lock", { mode: 0o600 });
  expect(() => writeSkillSession(child, { current: null, parent: skillSessionSnapshotBinding(parent) }, f))
    .toThrow(expect.objectContaining({ code: "SESSION_WRITE_LOCKED" }));
  expect(existsSync(locks[0]!)).toBe(false);
  expect(readFileSync(locks[1]!, "utf8")).toBe("busy-later-lock");
  expect(readSkillSession(childId, f)).toBeNull();
});

test("a busy session lock refuses both reconciliation and ordinary context writes", async () => {
  const f = fixture(false);
  const plan = await reconcileSkillSession(f.input, f);
  const lock = `${sessionReceiptPath("root", f)}.write-lock`;
  writeFileSync(lock, "existing writer", { mode: 0o600 });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  await expect(buildSkillContext({ profileId: "legacy", sessionId: "root" }, { ...f, client: { ...f.client, resolveProfile: async () => f.old.profile } })).rejects.toMatchObject({ code: "SESSION_WRITE_LOCKED" });
  expect(readFileSync(lock, "utf8")).toBe("existing writer");
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("session symlinks are refused without changing their targets", async () => {
  const f = fixture();
  const path = sessionReceiptPath("root", f), target = join(f.cacheDir, "untouched.json");
  writeFileSync(target, f.before); rmSync(path); symlinkSync(target, path);
  await expect(reconcileSkillSession(f.input, f)).rejects.toMatchObject({ code: "UNSAFE_CACHE_PATH" });
  expect(readFileSync(target)).toEqual(f.before);
});

test("a changed target with the same revision invalidates the reviewed plan", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, f);
  f.target.selections[0]!.bundleDigest = `sha256:${"b".repeat(64)}`;
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("a final receipt failure preserves both sides and reports the committed outcome as incomplete", async () => {
  const f = fixture(false), plan = await reconcileSkillSession(f.input, f);
  const rename = fs.renameSync;
  const fault = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("/receipt.json")) throw new Error("Synthetic final journal write failure");
    return rename(from, to);
  });
  try {
    await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_RECONCILIATION_INCOMPLETE" });
  } finally { fault.mockRestore(); }
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
  const directory = join(f.cacheDir, "session-reconciliations");
  const archive = join(directory, readdirSync(directory)[0]!);
  expect(readFileSync(join(archive, "original.json"))).toEqual(f.before);
  expect(readFileSync(join(archive, "replacement.json"))).toEqual(readFileSync(sessionReceiptPath("root", f)));
  expect(JSON.parse(readFileSync(join(archive, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("only identical loaded selections survive the explicit migration", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f);
  expect(readSkillSession("root", f)?.loaded).toEqual(f.old.loaded);
  const changed = fixture();
  changed.target.selections[0]!.bundleDigest = `sha256:${"b".repeat(64)}`;
  const changedPlan = await reconcileSkillSession(changed.input, changed);
  await reconcileSkillSession({ ...changed.input, apply: true, ...approval(changedPlan) }, changed);
  expect(readSkillSession("root", changed)?.loaded).toEqual([]);
});

test("failure to persist the archive parent refuses replacement and retains the old session", async () => {
  const f = fixture(false), plan = await reconcileSkillSession(f.input, f);
  const root = lstatSync(f.cacheDir), sync = fs.fsyncSync;
  const fault = spyOn(fs, "fsyncSync").mockImplementation(fd => {
    const current = fs.fstatSync(fd);
    if (current.dev === root.dev && current.ino === root.ino) throw new Error("Synthetic archive parent sync failure");
    sync(fd);
  });
  try {
    await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toThrow("Synthetic archive parent sync failure");
  } finally { fault.mockRestore(); }
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const directory = join(f.cacheDir, "session-reconciliations");
  const archive = join(directory, readdirSync(directory)[0]!);
  expect(readFileSync(join(archive, "original.json"))).toEqual(f.before);
  expect(JSON.parse(readFileSync(join(archive, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("a context read already in flight cannot overwrite the migrated session", async () => {
  const f = fixture(false);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const oldClient = { ...f.client, resolveProfile: async () => { entered(); await blocked; return f.old.profile; } };
  const context = buildSkillContext({ profileId: "legacy", sessionId: "root" }, { ...f, client: oldClient });
  await started;
  const plan = await reconcileSkillSession(f.input, f);
  await reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f);
  release();
  await expect(context).rejects.toMatchObject({ code: "SESSION_RECEIPT_CHANGED" });
  expect(readSkillSession("root", f)?.profile.profileId).toBe("shared");
});

test("receipt drift while resolving the API cannot overwrite concurrent changes", async () => {
  const f = fixture();
  const plan = await reconcileSkillSession(f.input, { cacheDir: f.cacheDir, client: f.client });
  const concurrent = { ...f.old, loaded: [] };
  f.client.resolveProfile = async () => { writeSelectionJson(sessionReceiptPath("root", f), concurrent); return f.target; };
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(plan) }, f)).rejects.toMatchObject({ code: "SESSION_RECEIPT_CHANGED" });
  expect(readSkillSession("root", f)).toEqual(concurrent);
});

test.each(["fromProfile", "fromRevision", "receiptSha256", "profileRevision"] as const)("requires the exact reviewed %s", async field => {
  const f = fixture();
  await expect(reconcileSkillSession({ ...f.input, [field]: field === "receiptSha256" ? "b".repeat(64) : "different" }, f)).rejects.toBeInstanceOf(Error);
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("reviewed plans bind a five-minute issuedAt/expiresAt window and expire at the replay boundary", async () => {
  const f = fixture(false), issued = Date.parse("2026-09-18T14:00:00.000Z");
  const planned = await reconcileSkillSession(f.input, { ...f, now: () => issued });
  expect(planned.plan.issuedAt).toBe("2026-09-18T14:00:00.000Z");
  expect(planned.plan.expiresAt).toBe("2026-09-18T14:05:00.000Z");
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { ...f, now: () => issued + 5 * 60 * 1000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_EXPIRED" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned), planExpiresAt: "2026-09-18T14:06:00.000Z" }, { ...f, now: () => issued + 1000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_WINDOW_INVALID" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned),
    planIssuedAt: "2026-09-18T14:00:01.000Z", planExpiresAt: "2026-09-18T14:05:01.000Z" }, { ...f, now: () => issued + 2000 }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});

test("a plan expiring during durable preparation is refused immediately before the receipt commit", async () => {
  const f = fixture(false), issued = Date.parse("2026-09-18T14:00:00.000Z");
  const planned = await reconcileSkillSession(f.input, { ...f, now: () => issued });
  let reads = 0;
  const now = () => ++reads >= 4 ? issued + 5 * 60 * 1000 : issued + 1000;
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(planned) }, { ...f, now }))
    .rejects.toMatchObject({ code: "SESSION_PLAN_EXPIRED" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
  const operation = join(f.cacheDir, "session-reconciliations", readdirSync(join(f.cacheDir, "session-reconciliations"))[0]!);
  expect(JSON.parse(readFileSync(join(operation, "receipt.json"), "utf8")).status).toBe("prepared");
});

test("apply needs the matching plan and may not cross authority or workspace", async () => {
  const f = fixture();
  await expect(reconcileSkillSession({ ...f.input, apply: true }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_REQUIRED" });
  await expect(reconcileSkillSession({ ...f.input, apply: true, ...approval(await reconcileSkillSession(f.input, f)), planDigest: "c".repeat(64) }, f)).rejects.toMatchObject({ code: "SESSION_PLAN_CHANGED" });
  f.target.workspaceId = "another-workspace";
  f.target.selections = f.target.selections.map(selection => ({ ...selection, workspaceId: f.target.workspaceId }));
  await expect(reconcileSkillSession(f.input, f)).rejects.toMatchObject({ code: "PROFILE_IDENTITY_MISMATCH" });
  expect(readFileSync(sessionReceiptPath("root", f))).toEqual(f.before);
});
