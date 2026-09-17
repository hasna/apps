import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection, SkillSelection } from "../types/skill-selection.js";
import { inspectSkillBundle, packSkillBundle, sha256Hex } from "./skill-bundle.js";
import { readSelectionProfile } from "./selection-cache.js";
import { loadSelectedSkill, syncSelectionProfile } from "./selection-resolver.js";
import { buildSkillContext } from "./skill-context.js";
import { readSelectedDocument } from "./selected-document.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = mkdtempSync(join(tmpdir(), "skills-selected-docs-")); roots.push(root); return root; }
const identity = { authority: "https://skills.example.com/api/v1", workspaceId: "docs-workspace", profileRevision: "docs-revision" };
function snapshot(selections: ResolvedSkillSelection[]): ResolvedSkillProfile {
  return { ...identity, profileId: "docs-profile", selections };
}
function fixture(files: Record<string, string>) {
  const source = directory(), cacheDir = directory(), sentinel = join(directory(), "executed");
  const allFiles = {
    "package.json": JSON.stringify({ name: "executable-docs", version: "1.0.0", main: "src/index.ts" }),
    "src/index.ts": `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
    ...files,
  };
  for (const [path, content] of Object.entries(allFiles)) { mkdirSync(dirname(join(source, path)), { recursive: true }); writeFileSync(join(source, path), content); }
  const bundle = packSkillBundle(source);
  const selection: ResolvedSkillSelection = { ...identity, slug: "executable-docs", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
  const client: ProfileClient = {
    authority: identity.authority, resolveProfile: async () => snapshot([selection]),
    getBundle: async () => new Response(bundle.bytes), recordStation: async () => { throw new Error("not used"); },
  };
  return { client, cacheDir, sentinel, selection, bundle };
}

describe("verified bundle documentation", () => {
  test("sync, exact load and context accept an executable with CLAUDE.md and never execute it", async () => {
    const body = "# Executable documentation\nUse the documented explicit run command.\n";
    const f = fixture({ "CLAUDE.md": body });
    const synced = await syncSelectionProfile("docs-profile", f);
    expect(synced.downloaded).toBe(1);
    const loaded = await loadSelectedSkill("executable-docs@1.0.0", "docs-profile", { cacheDir: f.cacheDir, cached: true });
    expect(loaded.content).toBe(body); expect(loaded.receipt.file).toBe("CLAUDE.md");
    const context = await buildSkillContext({ profileId: "docs-profile", skills: ["executable-docs@1.0.0"], sessionId: "docs-session" }, { cacheDir: f.cacheDir, cached: true });
    expect(context.context).toContain(body); expect(context.selections[0]?.bundleDigest).toBe(f.selection.bundleDigest);
    expect(existsSync(f.sentinel)).toBe(false);
    await expect(loadSelectedSkill("executable-docs", "docs-profile", { cacheDir: f.cacheDir, cached: true, file: "SKILL.md" })).rejects.toMatchObject({ code: "SKILL_FILE_MISSING" });
  });

  test("uses established SKILL, README, CLAUDE priority and preserves explicit file selection", async () => {
    const f = fixture({ "SKILL.md": "skill", "README.md": "readme", "CLAUDE.md": "claude" });
    const { entries } = await inspectSkillBundle(f.bundle.bytes);
    expect(readSelectedDocument(entries)).toEqual({ file: "SKILL.md", content: "skill" });
    expect(readSelectedDocument(entries.filter((entry) => entry.path !== "SKILL.md"))).toEqual({ file: "README.md", content: "readme" });
    expect(readSelectedDocument(entries, "CLAUDE.md")).toEqual({ file: "CLAUDE.md", content: "claude" });
    expect(readSelectedDocument(entries.map((entry) => entry.path === "SKILL.md" ? { ...entry, bytes: new Uint8Array() } : entry)).file).toBe("README.md");
  });

  test("a package without documentation still syncs; load/context refuse helpfully without executing", async () => {
    const f = fixture({});
    await syncSelectionProfile("docs-profile", f);
    expect(readSelectionProfile("docs-profile", f)?.profile.selections).toHaveLength(1);
    await expect(loadSelectedSkill("executable-docs", "docs-profile", { cacheDir: f.cacheDir, cached: true })).rejects.toMatchObject({ code: "SKILL_DOCS_MISSING" });
    await expect(buildSkillContext({ profileId: "docs-profile", skills: ["executable-docs"] }, { cacheDir: f.cacheDir, cached: true })).rejects.toThrow("loading context never runs the skill");
    expect((await loadSelectedSkill("executable-docs", "docs-profile", { cacheDir: f.cacheDir, cached: true, file: "package.json" })).receipt.file).toBe("package.json");
    expect(existsSync(f.sentinel)).toBe(false);
  });

  // Optional release regression uses privately fetched, digest-verified artifacts.
  // It performs no network calls and never logs or executes catalog content.
  test.skipIf(!process.env.HASNA_SKILLS_TEST_VERIFIED_CATALOG_PLAN || !process.env.HASNA_SKILLS_TEST_VERIFIED_CATALOG_DIR)("all current verified catalog bundles sync and load offline, including executable documentation", async () => {
    const plan = JSON.parse(readFileSync(process.env.HASNA_SKILLS_TEST_VERIFIED_CATALOG_PLAN!, "utf8")) as { selections: SkillSelection[] };
    const selections = plan.selections.map((selection) => ({ ...selection, ...identity }));
    const cacheDir = directory();
    const bytesFor = (selection: ResolvedSkillSelection) => readFileSync(join(process.env.HASNA_SKILLS_TEST_VERIFIED_CATALOG_DIR!, selection.bundleDigest.slice(7)));
    let downloads = 0;
    const client: ProfileClient = {
      authority: identity.authority, resolveProfile: async () => snapshot(selections),
      getBundle: async (slug, version) => { downloads++; return new Response(bytesFor(selections.find((selection) => selection.slug === slug && selection.version === version)!)); },
      recordStation: async () => { throw new Error("not used"); },
    };
    await syncSelectionProfile("docs-profile", { client, cacheDir });
    expect(downloads).toBe(selections.length);
    expect(readSelectionProfile("docs-profile", { cacheDir })?.profile.selections.length).toBe(selections.length);
    let fallbackCount = 0;
    for (const selection of selections) {
      const { entries } = await inspectSkillBundle(bytesFor(selection));
      const expected = readSelectedDocument(entries);
      if (expected.file !== "SKILL.md") fallbackCount++;
      const spec = `${selection.slug}@${selection.version}`;
      const loaded = await loadSelectedSkill(spec, "docs-profile", { cacheDir, cached: true });
      expect(loaded.receipt.file).toBe(expected.file);
      expect(sha256Hex(new TextEncoder().encode(loaded.content))).toBe(sha256Hex(new TextEncoder().encode(expected.content)));
      const context = await buildSkillContext({ profileId: "docs-profile", skills: [spec] }, { cacheDir, cached: true, maxChars: 64_000 });
      expect(context.selections.length + context.omitted.length).toBeGreaterThan(0);
      if (context.selections.length) expect(context.context.includes(expected.content)).toBe(true);
      else expect(context.omitted[0]?.reason).toBe("context-budget");
    }
    expect(fallbackCount).toBeGreaterThan(0);
    expect(downloads).toBe(selections.length);
  });
});
