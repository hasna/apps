import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CloudConfigStore } from "../data/config-store.js";
import type { Config, ProfileConfigBinding } from "../types/index.js";
import type { InstructionsStorageClient } from "./client-types.js";
import { legacyProfileConfigBinding, planProfileSessionRender } from "./instruction-graph.js";
import { applySessionRender, checkSessionRenderDrift, restoreSessionRenderSnapshot } from "./session-apply.js";
import { refreshSessionRender } from "./session-refresh.js";
import { planSessionRender, type SessionHostedProfileSelector } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const root = () => { const path = makeTempRoot("instructions-shared-project-"); roots.push(path); return path; };
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const manifestPath = (path: string) => join(path, ".hasna/session-render-manifest.json");
const manifestHash = (path: string) => hash(readFileSync(manifestPath(path), "utf8"));
const companion = { providerVersion: "2.1.278" as const };
const config: Config = {
  id: "shared-rule", name: "Shared project rule", slug: "shared-rule", kind: "file", category: "rules", agent: "global", target_path: null,
  outputs: [], format: "markdown", content: "PROJECT_ONLY_REVIEWED_RULE", description: null, tags: [], is_template: false,
  version: 1, created_at: "2026-09-19", updated_at: "2026-09-19", synced_at: null,
};
const binding: ProfileConfigBinding = {
  profile_id: "shared-project", config_id: config.id, sort_order: 0,
  binding: { ...legacyProfileConfigBinding(), providers: [{ provider: "sumi" }, { provider: "claude" }] },
};
function input(projectRoot = root()) {
  return { tool: "sumi" as const, profile: "project", profile_id: binding.profile_id, provider_version: "0.2.22",
    projectRoot, configs: [config], bindings: [binding], claudeProjectImport: companion, asset_plan_mode: "apply" as const };
}

describe("managed Claude relative project import", () => {
  test("uses one canonical body and transaction; a new root can roll back both files", () => {
    const args = input(), plan = planProfileSessionRender(args);
    const agents = plan.files.find((file) => file.relativePath === "AGENTS.md")!;
    const bridge = plan.files.find((file) => file.relativePath === "CLAUDE.md")!;
    expect(plan.targetKind).toBe("project-root");
    expect(bridge.content).toContain("\n@./AGENTS.md\n");
    expect(bridge.content).not.toContain(args.projectRoot);
    expect(bridge.content).not.toContain(config.content);
    expect(agents.content.split(config.content)).toHaveLength(2);
    expect(bridge.sourceIds).toEqual(agents.sourceIds);
    expect(plan.manifest.claudeProjectImport?.canonicalSha256).toBe(agents.sha256);
    const result = applySessionRender(plan);
    expect(result.applied).toBe(true); expect(result.snapshotPath).not.toBeNull();
    expect(checkSessionRenderDrift(args.projectRoot).clean).toBe(true);
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(existsSync(join(args.projectRoot, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(args.projectRoot, "CLAUDE.md"))).toBe(false);
    expect(existsSync(manifestPath(args.projectRoot))).toBe(false);
  });

  test("default project and global renders emit no companion and raw sources cannot enable it", () => {
    const args = input();
    expect(planProfileSessionRender({ ...args, claudeProjectImport: undefined }).files.some((file) => file.relativePath === "CLAUDE.md")).toBe(false);
    expect(() => planProfileSessionRender({ ...args, projectRoot: undefined, targetHome: root() })).toThrow("CLAUDE_PROJECT_IMPORT_TARGET");
    expect(() => planSessionRender({ tool: "sumi", profile: "raw", projectRoot: args.projectRoot, sources: [], claudeProjectImport: companion })).toThrow("REQUIRES_PROFILE");
    expect(() => planProfileSessionRender({ ...args, tool: "claude", provider_version: "2.1.278" })).toThrow("CLAUDE_PROJECT_IMPORT_TARGET");
  });

  test("requires explicit dual-provider bindings and identical compiled selection", () => {
    const args = input();
    for (const providers of [undefined, [{ provider: "sumi" as const }]]) {
      expect(() => planProfileSessionRender({ ...args, bindings: [{ ...binding, binding: { ...binding.binding, providers } }] })).toThrow("CLAUDE_PROJECT_IMPORT_BINDING");
    }
    expect(() => planProfileSessionRender({ ...args, extra_sources: [{ id: "unbound", content: "EXTRA" }] })).toThrow("CLAUDE_PROJECT_IMPORT_UNBOUND");
    const extra = { ...config, id: "claude-only", slug: "claude-only" };
    expect(() => planProfileSessionRender({ ...args, configs: [config, extra], bindings: [binding,
      { ...binding, config_id: extra.id, binding: { ...binding.binding, required: false, providers: [{ provider: "claude" }] } },
    ] })).toThrow("CLAUDE_PROJECT_IMPORT_DIVERGENT");
  });

  test("fails closed on unknown capabilities, alternate target homes and conditional sources", () => {
    const args = input();
    for (const version of ["2.1.279", "2.1.278-beta", "2.1.278 "]) {
      expect(() => planProfileSessionRender({ ...args, claudeProjectImport: { providerVersion: version as "2.1.278" } })).toThrow("CLAUDE_PROJECT_IMPORT_CAPABILITY");
    }
    expect(() => planProfileSessionRender({ ...args, targetHome: root() })).toThrow("CLAUDE_PROJECT_IMPORT_TARGET");
    expect(() => planProfileSessionRender({ ...args, bindings: [{ ...binding, binding: { ...binding.binding, activation: { mode: "glob", globs: ["src/**"] } } }] })).toThrow();
  });

  test("refuses provider-specific blocks after normalization", () => {
    const args = input();
    for (const marker of ["sumi", "claude"]) {
      expect(() => planProfileSessionRender({ ...args, configs: [{ ...config,
        content: `COMMON_POLICY\n<!-- @hasna-provider: ${marker} -->\nPROVIDER_ONLY_POLICY\n<!-- @hasna-end-provider -->\n`,
      }] })).toThrow("CLAUDE_PROJECT_IMPORT_DIVERGENT");
    }
  });

  test("different immutable source identities cannot impersonate equal shared prose", () => {
    const args = input(), first = { ...config, id: "source-a" }, second = { ...config, id: "source-b" };
    const scopedBinding = (id: string, selected: "sumi" | "claude"): ProfileConfigBinding => ({ ...binding, config_id: id, binding: {
      ...binding.binding, required: false, providers: [
        { provider: "sumi", version_range: selected === "sumi" ? ">=0.2.22" : ">=99.0.0" },
        { provider: "claude", version_range: selected === "claude" ? ">=2.1.278" : ">=99.0.0" },
      ],
    } });
    expect(() => planProfileSessionRender({ ...args, configs: [first, second], bindings: [scopedBinding(first.id, "sumi"), scopedBinding(second.id, "claude")] })).toThrow("CLAUDE_PROJECT_IMPORT_DIVERGENT");
  });

  test("rejects nested native imports, including absent files and malformed code, while preserving literal prose", () => {
    const args = input();
    for (const content of ["@README", "Read @./missing.md", "@../outside.md", "@/absolute.md", "@~/.claude/private.md", "@hasna/emails", "`unclosed @README", "```\n@README", "owner@example.test/path",
      "\\`literal @README end`", "`unclosed\n\n@README\n\nclosing`", "`unclosed\n# Heading @README\nclosing`", "<!--\n```\n-->\n@README\n```", "<span data-code=\"`\">@README</span>`",
      "COMMON\n\n[unused]: @README\n",
    ]) {
      expect(() => planProfileSessionRender({ ...args, configs: [{ ...config, content }] })).toThrow("CLAUDE_PROJECT_IMPORT_NESTED");
    }
    for (const content of ["Use `@hasna/emails` and write owner@example.test.", "Use ``literal ` @README`` only.", "```text\n@README\n```", "~~~text\n@README\n~~~"]) {
      expect(planProfileSessionRender({ ...args, configs: [{ ...config, content }] }).files.find((file) => file.relativePath === "AGENTS.md")!.content).toContain(content);
    }
    expect(() => planProfileSessionRender({ ...args, profile: "@../profile-import" })).toThrow("CLAUDE_PROJECT_IMPORT_NESTED");
    expect(() => planProfileSessionRender({ ...args, configs: [{ ...config, name: "@../label-import" }] })).toThrow("CLAUDE_PROJECT_IMPORT_NESTED");
  });

  test("refuses unmanaged companions, force, foreign owners and symlink escape", () => {
    const args = input(); writeFileSync(join(args.projectRoot, "CLAUDE.md"), "OWNER_CONTENT");
    const plan = planProfileSessionRender(args);
    expect(() => applySessionRender(plan)).toThrow("CLAUDE_PROJECT_IMPORT_CONFLICT");
    expect(() => applySessionRender(plan, { force: true })).toThrow("CLAUDE_PROJECT_IMPORT_FORCE");
    expect(readFileSync(join(args.projectRoot, "CLAUDE.md"), "utf8")).toBe("OWNER_CONTENT");
    expect(existsSync(join(args.projectRoot, "AGENTS.md"))).toBe(false);
    const owned = input(); applySessionRender(planProfileSessionRender(owned));
    expect(() => applySessionRender(planProfileSessionRender({ ...owned, profile: "other" }), { expectedManifestSha256: manifestHash(owned.projectRoot) })).toThrow("CLAUDE_PROJECT_IMPORT_OWNER");
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const linked = input(), outside = join(root(), "outside.md"); writeFileSync(outside, "KEEP"); symlinkSync(outside, join(linked.projectRoot, name));
      expect(() => applySessionRender(planProfileSessionRender(linked))).toThrow();
      expect(readFileSync(outside, "utf8")).toBe("KEEP");
    }
    const target = root(), alias = join(root(), "alias"); symlinkSync(target, alias);
    expect(() => applySessionRender(planProfileSessionRender(input(alias)))).toThrow();
  });

  test("requires exact preimages and rechecks both payloads before the first write", () => {
    const args = input(); applySessionRender(planProfileSessionRender(args));
    const expectedManifestSha256 = manifestHash(args.projectRoot), previousAgents = readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8");
    const update = planProfileSessionRender({ ...args, configs: [{ ...config, version: 2, content: "CHANGED" }] });
    expect(() => applySessionRender(update)).toThrow("CLAUDE_PROJECT_IMPORT_CAS");
    expect(() => applySessionRender(update, { expectedManifestSha256: "0".repeat(64) })).toThrow();
    expect(() => applySessionRender(update, { expectedManifestSha256, test_hooks: { before_apply_writes: () => writeFileSync(join(args.projectRoot, "CLAUDE.md"), "CONCURRENT_OWNER_EDIT") } })).toThrow();
    expect(readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8")).toBe(previousAgents);
    expect(manifestHash(args.projectRoot)).toBe(expectedManifestSha256);
  });

  test("adopts an exact reviewed canonical preimage and rolls it back without touching other files", () => {
    const args = input(), old = "PRESERVE_PRIOR_POLICY"; writeFileSync(join(args.projectRoot, "AGENTS.md"), old);
    mkdirSync(join(args.projectRoot, ".claude")); writeFileSync(join(args.projectRoot, ".claude/settings.json"), "{}");
    const result = applySessionRender(planProfileSessionRender(args), { adoptFiles: [{ relativePath: "AGENTS.md", sha256: hash(old) }] });
    expect(result.applied).toBe(true);
    expect(restoreSessionRenderSnapshot(result.snapshotPath!).restored).toBe(true);
    expect(readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8")).toBe(old);
    expect(existsSync(join(args.projectRoot, "CLAUDE.md"))).toBe(false);
    expect(readFileSync(join(args.projectRoot, ".claude/settings.json"), "utf8")).toBe("{}");
  });

  test("hosted refresh rechecks dual bindings, retains the import and supports rollback", async () => {
    const args = input(), authority = "https://instructions.example.test/v1";
    const selector: SessionHostedProfileSelector = { schema: "hasna.instructions.hosted-profile-selector/v1", authority, profileId: binding.profile_id,
      providerVersion: "0.2.22", manual: [], codewithNativeImports: false, allowEmptySources: false, stationProfile: false, checkGlobalCoverage: false, claudeProjectImport: companion };
    let configs = [config], bindings = [binding];
    const profile = { id: binding.profile_id, name: "Shared", slug: "shared", description: null, selectors: {}, variables: {}, created_at: "2026-09-19", updated_at: "2026-09-19" };
    const request = async <T>(_method: string, path: string): Promise<T> => {
      if (path.includes("/bindings")) return { bindings } as T;
      if (path.includes("/assets")) return { assets: [] } as T;
      if (path.startsWith("/profiles?")) return { profiles: [profile] } as T;
      if (path.startsWith(`/profiles/${binding.profile_id}`)) return { profile: { ...profile, configs } } as T;
      throw new Error(`Unexpected fixture request: ${path}`);
    };
    const store = new CloudConfigStore({ name: "instructions", baseUrl: authority, transport: { baseUrl: authority, request } } as InstructionsStorageClient);
    applySessionRender(planProfileSessionRender({ ...args, refreshSelector: selector }));
    const before = readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8"), bridge = readFileSync(join(args.projectRoot, "CLAUDE.md"), "utf8");
    expect((await refreshSessionRender({ targetHome: args.projectRoot, store })).status).toBe("unchanged");
    configs = [{ ...config, version: 2, content: "UPDATED_HOSTED_PROJECT_POLICY" }];
    const result = await refreshSessionRender({ targetHome: args.projectRoot, store });
    expect(result.status).toBe("updated");
    expect(readFileSync(join(args.projectRoot, "CLAUDE.md"), "utf8")).toBe(bridge);
    const manifest = JSON.parse(readFileSync(manifestPath(args.projectRoot), "utf8"));
    expect(manifest.claudeProjectImport.canonicalSha256).toBe(hash(readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8")));
    expect(manifest.refreshSelector.claudeProjectImport).toEqual(companion);
    expect((await refreshSessionRender({ targetHome: args.projectRoot, store })).status).toBe("unchanged");
    bindings = [{ ...binding, binding: { ...binding.binding, providers: [{ provider: "sumi" }] } }];
    await expect(refreshSessionRender({ targetHome: args.projectRoot, store })).rejects.toThrow("CLAUDE_PROJECT_IMPORT_BINDING");
    expect(restoreSessionRenderSnapshot(result.apply.snapshotPath!).restored).toBe(true);
    expect(readFileSync(join(args.projectRoot, "AGENTS.md"), "utf8")).toBe(before);
    expect(readFileSync(join(args.projectRoot, "CLAUDE.md"), "utf8")).toBe(bridge);
    expect(() => applySessionRender(planProfileSessionRender({ ...args, claudeProjectImport: undefined }), { expectedManifestSha256: manifestHash(args.projectRoot) })).toThrow("CLAUDE_PROJECT_IMPORT_RETIREMENT");
  });
});
