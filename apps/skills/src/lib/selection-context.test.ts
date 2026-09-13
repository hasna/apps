import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";
import { packSkillBundle } from "./skill-bundle.js";
import { cacheSelectionBundle, readCachedSelection, readSelectionProfile, selectionBundlePath, type SelectionCacheOptions } from "./selection-cache.js";
import { loadSelectedSkill, syncSelectionProfile } from "./selection-resolver.js";
import { buildSkillContext } from "./skill-context.js";
import { parseSkillContextInput } from "../cli/commands/context.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory(): string { const root = mkdtempSync(join(tmpdir(), "skills-selection-")); roots.push(root); return root; }
function fixture(version = "1.0.0", body = "Review the changed code carefully.", slug = "review-code") {
  const source = directory();
  const markdown = `---\nname: ${slug}\ndescription: Review changed code\nkind: instruction\n---\n\n${body}\n`;
  writeFileSync(join(source, "SKILL.md"), markdown);
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: slug, version, skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const selection: ResolvedSkillSelection = { authority: "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileRevision: "revision-one", slug, version, bundleDigest: `sha256:${bundle.sha256}` };
  return { selection, bundle, markdown, response: () => new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": version } }) };
}
function profile(selections: ResolvedSkillSelection[], revision = "revision-one"): ResolvedSkillProfile {
  return { authority: selections[0]?.authority ?? "https://skills.example.com/api/v1", workspaceId: "workspace-one", profileId: "engineering", profileRevision: revision, selections: selections.map((selection) => ({ ...selection, profileRevision: revision })) };
}
function clientFor(f: ReturnType<typeof fixture>, snapshot = profile([f.selection])): ProfileClient {
  return { authority: f.selection.authority, resolveProfile: async () => snapshot, getBundle: async () => f.response(), recordStation: async (_id, _state) => { throw new Error("not used"); } };
}

describe("immutable selected Skills cache", () => {
  test("verifies exact bytes, isolates authorities/workspaces, and preserves authoring drafts", async () => {
    const cacheDir = directory();
    const f = fixture();
    const draft = join(cacheDir, "installed", f.selection.slug);
    mkdirSync(draft, { recursive: true }); writeFileSync(join(draft, "SKILL.md"), "private draft");
    await cacheSelectionBundle(f.selection, f.response(), { cacheDir });
    expect((await readCachedSelection(f.selection, { cacheDir }))?.find((entry) => entry.path === "SKILL.md")?.bytes).toEqual(new TextEncoder().encode(f.markdown));
    expect(await readCachedSelection({ ...f.selection, workspaceId: "workspace-two" }, { cacheDir })).toBeNull();
    expect(await readCachedSelection({ ...f.selection, authority: "https://other.example.com/api/v1" }, { cacheDir })).toBeNull();
    expect(readFileSync(join(draft, "SKILL.md"), "utf8")).toBe("private draft");
    await expect(cacheSelectionBundle(f.selection, new Response("wrong bytes"), { cacheDir })).rejects.toMatchObject({ code: "BUNDLE_DIGEST_MISMATCH" });
    expect(await readCachedSelection(f.selection, { cacheDir })).not.toBeNull();
  });
  test("detects corruption and refuses cache-root symlinks", async () => {
    const f = fixture(); const cacheDir = directory();
    await cacheSelectionBundle(f.selection, f.response(), { cacheDir });
    // Operator permissions allow replacing this file; a changed body still cannot pass a cache read.
    rmSync(selectionBundlePath(f.selection, { cacheDir }));
    writeFileSync(selectionBundlePath(f.selection, { cacheDir }), "corrupt");
    await expect(readCachedSelection(f.selection, { cacheDir })).rejects.toMatchObject({ code: "BUNDLE_DIGEST_MISMATCH" });
    const alias = join(directory(), "alias"); symlinkSync(directory(), alias);
    await expect(cacheSelectionBundle(f.selection, f.response(), { cacheDir: alias })).rejects.toMatchObject({ code: "UNSAFE_CACHE_PATH" });
  });
  test("only activates after every selected object verifies", async () => {
    const f = fixture(); const cacheDir = directory();
    const client = clientFor(f);
    await syncSelectionProfile("engineering", { client, cacheDir });
    const bad = fixture("2.0.0", "new content", "second-skill");
    client.resolveProfile = async () => profile([f.selection, bad.selection], "revision-two");
    client.getBundle = async (slug) => slug === f.selection.slug ? f.response() : new Response("corrupt");
    await expect(syncSelectionProfile("engineering", { client, cacheDir })).rejects.toMatchObject({ code: "BUNDLE_DIGEST_MISMATCH" });
    expect(readSelectionProfile("engineering", { cacheDir })?.profile.profileRevision).toBe("revision-one");
  });
  test("two project locks retain simultaneous exact versions through later profile changes", async () => {
    const v1 = fixture(); const v2 = fixture("2.0.0", "Second revision.");
    const cacheDir = directory(), projectA = directory(), projectB = directory();
    const client = clientFor(v1);
    await syncSelectionProfile("engineering", { client, cacheDir, projectDir: projectA });
    client.resolveProfile = async () => profile([v2.selection], "revision-two");
    client.getBundle = async (_slug, version) => version === "1.0.0" ? v1.response() : v2.response();
    await syncSelectionProfile("engineering", { client, cacheDir, projectDir: projectB });
    expect((await loadSelectedSkill("review-code@1.0.0", "engineering", { client, cacheDir, projectDir: projectA })).content).toBe(v1.markdown);
    expect((await loadSelectedSkill("review-code@2.0.0", "engineering", { client, cacheDir, projectDir: projectB })).content).toBe(v2.markdown);
    await expect(loadSelectedSkill("review-code@2.0.0", "engineering", { client, cacheDir, projectDir: projectA })).rejects.toMatchObject({ code: "SKILL_NOT_SELECTED" });
  });
  test("authentication/network errors do not become cache reads; explicit cache has a bounded lifetime", async () => {
    const f = fixture(); const cacheDir = directory(); const client = clientFor(f); const now = Date.now();
    await syncSelectionProfile("engineering", { client, cacheDir, now: () => now });
    client.resolveProfile = async () => { throw new Error("authentication failed"); };
    await expect(loadSelectedSkill("review-code@1.0.0", "engineering", { client, cacheDir })).rejects.toThrow("authentication failed");
    expect((await loadSelectedSkill("review-code@1.0.0", "engineering", { cached: true, cacheDir, authority: f.selection.authority, now: () => now + 1000 })).content).toBe(f.markdown);
    await expect(loadSelectedSkill("review-code@1.0.0", "engineering", { cached: true, cacheDir, authority: "https://other.example.com/api/v1", now: () => now + 1000 })).rejects.toMatchObject({ code: "PROFILE_IDENTITY_MISMATCH" });
    await expect(loadSelectedSkill("review-code@1.0.0", "engineering", { cached: true, cacheDir, now: () => now + 25 * 60 * 60 * 1000 })).rejects.toMatchObject({ code: "CACHED_PROFILE_EXPIRED" });
  });
});

describe("selected prompt context", () => {
  test("deterministic prompt/path rules, no unrelated content, and complete-body budgets", async () => {
    const f = fixture(); const cacheDir = directory();
    const snapshot = profile([{ ...f.selection, triggers: { keywords: ["audit"], paths: ["**/src/*.ts"] } }]);
    const client = clientFor(f, snapshot);
    const options = { cacheDir, client };
    const input = { prompt: "audit this change", profileId: "engineering" };
    const result = await buildSkillContext(input, options);
    expect(result.context).toContain(f.markdown); expect(result.selections[0]?.reason).toBe("prompt");
    expect((await buildSkillContext(input, options)).receipt.id).toBe(result.receipt.id);
    expect((await buildSkillContext({ prompt: "hello", profileId: "engineering" }, options)).context).toBe("");
    expect((await buildSkillContext({ prompt: "hello", paths: ["repo/src/index.ts"], profileId: "engineering" }, options)).selections[0]?.reason).toBe("path");
    const large = fixture("2.0.0", "A complete long procedure. ".repeat(100));
    const longResult = await buildSkillContext({ prompt: "review code", profileId: "engineering" }, { client: clientFor(large), cacheDir, maxChars: 512 });
    expect(longResult.context).toBe(""); expect(longResult.omitted[0]?.reason).toBe("context-budget");
    expect(longResult.omitted[0]?.loadCommand).toContain("review-code@2.0.0");
  });
  test("session pins, deduplication, compaction restore, and subagent isolation", async () => {
    const f = fixture(); const cacheDir = directory(); const client = clientFor(f);
    const input = { prompt: "review code", profileId: "engineering", sessionId: "session-one" };
    expect((await buildSkillContext(input, { client, cacheDir })).selections).toHaveLength(1);
    expect((await buildSkillContext(input, { client, cacheDir })).context).toBe("");
    const v2 = fixture("2.0.0", "New revision.");
    client.resolveProfile = async () => profile([v2.selection], "revision-two");
    client.getBundle = async (_slug, version) => version === "1.0.0" ? f.response() : v2.response();
    const restored = await buildSkillContext({ ...input, prompt: "", restore: true }, { client, cacheDir });
    expect(restored.context).toContain(f.markdown); expect(restored.selections[0]?.reason).toBe("session-restore");
    // A subagent receives an independent receipt rather than consuming the parent's dedup state.
    const child = await buildSkillContext({ ...input, prompt: "", agentId: "child-one" }, { client, cacheDir });
    expect(child.selections[0]?.version).toBe("1.0.0");
    expect(child.selections[0]?.reason).toBe("subagent-inherit");
    expect(child.receipt.sessionId).toBe("session-one:child-one");
  });
  test("native hook payloads preserve restore and child identity without storing prompts", () => {
    expect(parseSkillContextInput(JSON.stringify({ prompt: "review code", cwd: "/tmp/project", session_id: "one", agent_id: "child", hook_event_name: "SessionStart", source: "compact" }))).toMatchObject({ prompt: "review code", cwd: "/tmp/project", sessionId: "one", agentId: "child", restore: true });
    expect(() => parseSkillContextInput('{"prompt":42}')).toThrow("must be a string");
  });
});
